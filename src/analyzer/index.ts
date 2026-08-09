import * as fs from "node:fs";
import * as path from "node:path";
import type {
  AliasMap,
  AstSummary,
  ConfigFileInfo,
  EnvDefinition,
  FrameworkAdapter,
  FrameworkContext,
  FrameworkName,
  IndexedFile,
  LockInfo,
  ScriptInfo,
  WorkspaceInfo,
} from "../types/index.js";
import { analyzeAst, analyzeRegexFallback } from "./ast/index.js";
import { type FileIndex, indexFiles, CONFIG_TOOL } from "./file-indexer.js";
import { buildImportGraph, type ImportGraph } from "./graph.js";
import { createResolverContext, discoverAliasMaps, type ResolverContext } from "./resolver.js";
import { analyzeConfigFiles, type ConfigAnalysis, isLegacyConfig } from "./config-refs.js";
import {
  analyzeScripts,
  buildBinMap,
  collectWorkspaces,
  readPnpmWorkspaces,
} from "./deps.js";
import { analyzeLockfile } from "./lockfile.js";
import { detectGit, type GitInfo } from "./git.js";
import { classifyTests } from "./tests.js";
import { parseCiEnv, parseDockerEnv, parseEnvFile, scanScriptEnv } from "./env.js";
import { allAdapters, detectFramework } from "../frameworks/registry.js";
import { readPackageJson, type LoadedConfig } from "../config/load.js";
import { createIgnoreMatcher, mergeIgnoreLines } from "../utils/ignore.js";
import { shortHash } from "../utils/hash.js";
import { fileExists } from "../utils/fs.js";

export interface AnalyzerContext {
  root: string;
  files: IndexedFile[];
  texts: Map<string, string>;
  ast: Map<string, AstSummary>;
  workspaces: WorkspaceInfo[];
  rootPkg: Record<string, unknown> | null;
  lock: LockInfo;
  pkgNames: Set<string>;
  framework: FrameworkName;
  frameworkAdapters: FrameworkAdapter[];
  entries: Set<string>;
  virtual: Set<string>;
  implicitPackages: Set<string>;
  aliasMaps: AliasMap[];
  testFiles: Set<string>;
  configFiles: ConfigFileInfo[];
  configAnalysis: ConfigAnalysis;
  graph: ImportGraph;
  resolver: ResolverContext;
  scriptsByWorkspace: Map<string, Map<string, ScriptInfo>>;
  envUsage: Map<string, Set<string>>;
  envDefs: EnvDefinition[];
  git: GitInfo;
  cacheDir: string | null;
}

export interface AnalyzeOptions {
  root: string;
  ignore?: string[];
  framework?: "auto" | FrameworkName;
  enableCache?: boolean;
  onProgress?: (stage: string, message?: string) => void;
}

const CACHE_VERSION = 3;

function report(
  onProgress: AnalyzeOptions["onProgress"],
  stage: string,
  message?: string,
): void {
  onProgress?.(stage, message);
}

export async function analyzeProject(opts: AnalyzeOptions): Promise<AnalyzerContext> {
  const root = path.resolve(opts.root);
  report(opts.onProgress, "index", "Indexing repository...");

  const loaded = loadProjectIgnore(root, opts.ignore ?? []);
  const fileIndex: FileIndex = await indexFiles(root, loaded.matcher);

  report(opts.onProgress, "index", `${fileIndex.files.length} files indexed`);

  const cacheDir =
    opts.enableCache === false ? null : path.join(root, ".nullcode-cache");

  // 1. Parse all source files (with cache when enabled).
  const ast = new Map<string, AstSummary>();
  let parsed = 0;
  for (const file of fileIndex.files) {
    if (file.kind !== "source" && file.kind !== "test") continue;
    const text = fileIndex.texts.get(file.abs) ?? "";
    let summary: AstSummary | null = null;
    if (cacheDir) {
      summary = await readCachedSummary(cacheDir, file.abs, text);
    }
    if (!summary) {
      if (file.ext === ".vue") {
        summary = analyzeRegexFallback(file.abs, text);
      } else {
        summary = analyzeAst(file.abs, text);
      }
      if (cacheDir) void writeCachedSummary(cacheDir, file.abs, text, summary);
    }
    if (summary) {
      ast.set(file.abs, summary);
      parsed++;
    }
  }
  report(opts.onProgress, "ast", `${parsed} source files parsed`);

  // 2. Workspaces + dependencies.
  const rootPkg = readPackageJson(path.join(root, "package.json"));
  const workspacesField = rootPkg?.["workspaces"] as
    | string[]
    | { packages?: string[] }
    | undefined;
  const pnpmPatterns = readPnpmWorkspaces(root);
  const workspaceDirs = collectWorkspaces(root, workspacesField, pnpmPatterns);
  const allDirs = [root, ...workspaceDirs];
  const workspaces: WorkspaceInfo[] = [];
  const pkgNames = new Set<string>();
  for (const dir of allDirs) {
    const pkgPath = path.join(dir, "package.json");
    const pkg = readPackageJson(pkgPath);
    if (!pkg) continue;
    const name =
      typeof pkg["name"] === "string"
        ? pkg["name"]
        : dir === root
          ? "(root)"
          : path.basename(dir);
    const depsOf = (key: string): Map<string, string> => {
      const map = new Map<string, string>();
      const section = pkg[key];
      if (section && typeof section === "object") {
        for (const [n, v] of Object.entries(section as Record<string, unknown>)) {
          if (typeof v === "string") map.set(n, v);
        }
      }
      return map;
    };
    const ws: WorkspaceInfo = {
      dir,
      name,
      pkgJson: pkg,
      dependencies: depsOf("dependencies"),
      devDependencies: depsOf("devDependencies"),
      optionalDependencies: depsOf("optionalDependencies"),
      version:
        typeof pkg["version"] === "string" ? (pkg["version"] as string) : undefined,
    };
    workspaces.push(ws);
    for (const n of ws.dependencies.keys()) pkgNames.add(n);
    for (const n of ws.devDependencies.keys()) pkgNames.add(n);
    for (const n of ws.optionalDependencies.keys()) pkgNames.add(n);
  }
  report(opts.onProgress, "deps", `${workspaces.length} packages analyzed`);

  const lock = analyzeLockfile(root);
  const workspaceNames = new Map<string, string>();
  for (const ws of workspaces) {
    if (ws.name !== "(root)") workspaceNames.set(ws.name, ws.dir);
  }

  // 3. Aliases from bundler configs (tsconfig handled lazily in resolver).
  const aliasMaps: AliasMap[] = discoverAliasMaps(root, fileIndex.files.map((f) => f.rel));

  // 4. Framework detection.
  const fwCtx: FrameworkContext = {
    root,
    rootDir: root,
    workspaces,
    allFiles: fileIndex.files.map((f) => f.rel),
    pkgNames,
  };
  const preferred = opts.framework ?? "auto";
  const framework = detectFramework(fwCtx, preferred);
  const adapters = allAdapters();
  const frameworkAdapters = adapters.filter(
    (a) => preferred !== "auto" || a.name === framework,
  );

  const entries = new Set<string>();
  const virtual = new Set<string>();
  const implicitPackages = new Set<string>();
  for (const adapter of frameworkAdapters) {
    for (const e of adapter.entries(fwCtx)) entries.add(e);
    for (const v of adapter.virtualFiles(fwCtx)) virtual.add(v);
    for (const p of adapter.implicitPackages(fwCtx)) implicitPackages.add(p);
    aliasMaps.push(...adapter.aliasMaps(fwCtx));
  }
  // package.json entry fields
  for (const ws of workspaces) {
    for (const field of ["main", "module", "browser"] as const) {
      const v = ws.pkgJson[field];
      if (typeof v === "string" && v.startsWith(".")) {
        const abs = path.join(ws.dir, v.replace(/^\.\//, ""));
        if (fileExists(abs)) entries.add(abs);
      }
    }
    const exportsField = ws.pkgJson["exports"];
    if (exportsField && typeof exportsField === "object") {
      const visit = (o: Record<string, unknown>): void => {
        for (const [k, v] of Object.entries(o)) {
          const isTarget =
            k === "require" || k === "import" || k === "default" || k === "types";
          if (isTarget && typeof v === "string" && v.startsWith(".")) {
            const abs = path.join(ws.dir, v.replace(/^\.\//, ""));
            if (fileExists(abs)) entries.add(abs);
          } else if (typeof v === "object" && v !== null) {
            visit(v as Record<string, unknown>);
          }
        }
      };
      visit(exportsField as Record<string, unknown>);
    }
  }

  // 5. Scripts + config references.
  const binMap = buildBinMap(root, [...pkgNames]);
  const scriptsByWorkspace = new Map<string, Map<string, ScriptInfo>>();
  for (const ws of workspaces) {
    scriptsByWorkspace.set(ws.dir, analyzeScripts(ws, binMap));
  }
  for (const [, scripts] of scriptsByWorkspace) {
    for (const script of scripts.values()) {
      for (const p of script.fileUsage) {
        if (fileExists(p)) entries.add(p);
      }
    }
  }

  const configFiles: ConfigFileInfo[] = [];
  const allConfigBasenames = new Set<string>();
  for (const f of fileIndex.files) {
    if (f.kind === "config") {
      allConfigBasenames.add(path.basename(f.rel));
    }
  }
  for (const f of fileIndex.files) {
    if (f.kind !== "config") continue;
    const tool = CONFIG_TOOL[path.basename(f.rel)] ?? "unknown";
    const legacy = isLegacyConfig(f, allConfigBasenames);
    configFiles.push({ abs: f.abs, rel: f.rel, tool, auto: true, legacy });
  }
  const configAnalysis = analyzeConfigFiles(fileIndex.files, fileIndex.texts, pkgNames, root);

  // 6. Import graph.
  const resolver = createResolverContext(root, aliasMaps, workspaceNames);
  const graph = buildImportGraph(ast, resolver);

  // 7. Env usage.
  const envUsage = new Map<string, Set<string>>();
  for (const [fileAbs, summary] of ast) {
    for (const ref of summary.env) {
      let set = envUsage.get(ref.key);
      if (!set) {
        set = new Set();
        envUsage.set(ref.key, set);
      }
      set.add(fileAbs);
    }
  }
  for (const [, scripts] of scriptsByWorkspace) {
    for (const script of scripts.values()) {
      for (const key of scanScriptEnv(script.value)) {
        let set = envUsage.get(key);
        if (!set) {
          set = new Set();
          envUsage.set(key, set);
        }
        set.add(`script:${script.name}`);
      }
    }
  }

  const envDefs: EnvDefinition[] = [];
  for (const f of fileIndex.files) {
    if (f.kind !== "env") continue;
    const text = fileIndex.texts.get(f.abs) ?? "";
    const isExample = /\.example(\.|$)/.test(f.rel) || f.rel.endsWith(".env.example");
    for (const [key, value] of parseEnvFile(text)) {
      envDefs.push({ key, value, file: f.rel, kind: isExample ? "example" : "env-file" });
    }
  }
  for (const f of fileIndex.files) {
    const base = path.basename(f.rel).toLowerCase();
    const text = fileIndex.texts.get(f.abs) ?? "";
    if (base.startsWith("dockerfile")) {
      for (const key of parseDockerEnv(text)) {
        envDefs.push({ key, value: "", file: f.rel, kind: "docker" });
      }
    } else if (/^\.github\/workflows\/.+\.ya?ml$/.test(f.rel) || f.rel === ".gitlab-ci.yml") {
      for (const key of parseCiEnv(text)) {
        envDefs.push({ key, value: "", file: f.rel, kind: "ci" });
      }
    }
  }

  // 8. Test files.
  const tests = classifyTests(fileIndex.files);
  const testFiles = new Set<string>();
  for (const f of tests.testFiles) testFiles.add(f);
  for (const f of tests.testUtils) testFiles.add(f);

  // 9. Git.
  const git = await detectGit(root);
  report(
    opts.onProgress,
    "git",
    git.available ? "Git history analyzed" : "Git not available (history skipped)",
  );

  return {
    root,
    files: fileIndex.files,
    texts: fileIndex.texts,
    ast,
    workspaces,
    rootPkg,
    lock,
    pkgNames,
    framework,
    frameworkAdapters,
    entries,
    virtual,
    implicitPackages,
    aliasMaps,
    testFiles,
    configFiles,
    configAnalysis,
    graph,
    resolver,
    scriptsByWorkspace,
    envUsage,
    envDefs,
    git,
    cacheDir,
  };
}

function loadProjectIgnore(
  root: string,
  extra: string[],
): { matcher: ReturnType<typeof createIgnoreMatcher>; ignoreLines: string[] } {
  const loaded: LoadedConfig = readIgnoreFile(root);
  const lines = mergeIgnoreLines([...loaded.ignoreLines ?? [], ...extra]);
  return { matcher: createIgnoreMatcher(lines), ignoreLines: lines };
}

function readIgnoreFile(root: string): LoadedConfig {
  const lines: string[] = [];
  const file = path.join(root, ".nullcodeignore");
  try {
    if (fs.existsSync(file)) {
      const content = fs.readFileSync(file, "utf8");
      for (const line of content.split(/\r?\n/)) lines.push(line);
    }
  } catch {
    // ignore unreadable files
  }
  return { ignoreLines: lines, matcher: createIgnoreMatcher(lines), userConfig: {} };
}

/* ------------------------------------------------------------------ */
/* Cache                                                               */
/* ------------------------------------------------------------------ */

interface CachedSummary {
  v: number;
  hash: string;
  summary: AstSummary;
}

async function readCachedSummary(
  cacheDir: string,
  abs: string,
  text: string,
): Promise<AstSummary | null> {
  const hash = shortHash(text);
  const file = path.join(cacheDir, `${abs.replace(/[/\\]/g, "_")}_${hash}.json`);
  try {
    const raw = await fs.promises.readFile(file, "utf8");
    const data = JSON.parse(raw) as CachedSummary;
    if (data.v === CACHE_VERSION && data.hash === hash) {
      return data.summary as AstSummary;
    }
  } catch {
    // miss
  }
  return null;
}

async function writeCachedSummary(
  cacheDir: string,
  abs: string,
  text: string,
  summary: AstSummary,
): Promise<void> {
  const hash = shortHash(text);
  try {
    await fs.promises.mkdir(cacheDir, { recursive: true });
    const payload: CachedSummary = { v: CACHE_VERSION, hash, summary };
    await fs.promises.writeFile(
      path.join(cacheDir, `${abs.replace(/[/\\]/g, "_")}_${hash}.json`),
      JSON.stringify(payload),
      "utf8",
    );
  } catch {
    // cache write failures are non-fatal
  }
}