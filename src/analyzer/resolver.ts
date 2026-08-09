import * as fs from "node:fs";
import * as path from "node:path";
import ts from "typescript";
import type { AliasMap, ResolvedImport } from "../types/index.js";
import { fileExists, pathExists, walkFiles } from "../utils/fs.js";
import { createIgnoreMatcher } from "../utils/ignore.js";

const FILE_EXTENSIONS = [
  ".ts",
  ".mts",
  ".cts",
  ".tsx",
  ".js",
  ".mjs",
  ".cjs",
  ".jsx",
  ".vue",
  ".json",
];

export interface ResolverContext {
  root: string;
  aliasMaps: AliasMap[];
  workspaceNames: Map<string, string>;
  memo: Map<string, ResolvedImport>;
  resolve: (spec: string, importerAbs: string) => ResolvedImport;
}

export function createResolverContext(
  root: string,
  aliasMaps: AliasMap[],
  workspaceNames: Map<string, string>,
): ResolverContext {
  const ctx: ResolverContext = {
    root,
    aliasMaps,
    workspaceNames,
    memo: new Map(),
    resolve: (spec, importerAbs) => resolveImport(spec, importerAbs, ctx),
  };
  return ctx;
}

export function stripQuery(spec: string): string {
  const q = spec.indexOf("?");
  return q === -1 ? spec : spec.slice(0, q);
}

function tryResolveFile(abs: string, _root: string): string | null {
  if (fileExists(abs)) return path.resolve(abs);
  if (pathExists(abs) ) {
    // directory: index resolution
    for (const ext of FILE_EXTENSIONS) {
      const candidate = path.join(abs, `index${ext}`);
      if (fileExists(candidate)) return path.resolve(candidate);
    }
    return null;
  }
  for (const ext of FILE_EXTENSIONS) {
    const candidate = `${abs}${ext}`;
    if (fileExists(candidate)) return path.resolve(candidate);
  }
  return null;
}

function matchAlias(spec: string, alias: AliasMap): string | null {
  if (!alias.hasStar) {
    if (spec === alias.from) return alias.to;
    if (spec.startsWith(alias.from + "/") && dirExistsLike(alias.to)) {
      return path.join(alias.to, spec.slice(alias.from.length + 1));
    }
    return null;
  }
  const starIdx = alias.from.indexOf("*");
  const pre = alias.from.slice(0, starIdx);
  const post = alias.from.slice(starIdx + 1);
  if (!spec.startsWith(pre)) return null;
  if (!spec.endsWith(post)) return null;
  const sub = spec.slice(pre.length, spec.length - post.length);
  if (sub.includes("/") === false || alias.to.includes("*")) {
    return alias.to.replace("*", sub);
  }
  return null;
}

function dirExistsLike(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** Resolve the importable entry of a workspace package: `main`/`module` from
 * its package.json, then conventional src/index entries. */
function resolveWorkspaceEntry(dir: string): string | null {
  const pkgPath = path.join(dir, "package.json");
  if (fileExists(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as Record<string, unknown>;
      for (const field of ["main", "module", "types"] as const) {
        const value = pkg[field];
        if (typeof value === "string" && value.length > 0) {
          const resolved = tryResolveFile(path.resolve(dir, value), dir);
          if (resolved) return resolved;
        }
      }
    } catch {
      // fall through to conventional entries
    }
  }
  for (const candidate of ["src/index.ts", "src/index.tsx", "src/index.js", "index.ts", "index.js"]) {
    const abs = path.join(dir, candidate);
    if (fileExists(abs)) return path.resolve(abs);
  }
  return null;
}

export function resolveImport(
  specRaw: string,
  importerAbs: string,
  ctx: ResolverContext,
): ResolvedImport {
  const spec = stripQuery(specRaw);
  if (spec.length === 0) return { kind: "unresolved", specifier: specRaw };

  const memoKey = `${importerAbs}::${specRaw}`;
  const memoized = ctx.memo.get(memoKey);
  if (memoized) return memoized;

  let result: ResolvedImport;

  if (spec.startsWith("node:")) {
    result = { kind: "builtin", specifier: specRaw };
  } else if (
    spec.startsWith(".") ||
    spec.startsWith("/") ||
    spec.startsWith("#") ||
    spec.startsWith("@")
  ) {
    // Alias maps first (they may shadow relative-looking specs, including
    // tsconfig paths like "@/*" which start with "@").
    for (const alias of ctx.aliasMaps) {
      const target = matchAlias(spec, alias);
      if (target) {
        const abs = path.isAbsolute(target) ? target : path.resolve(ctx.root, target);
        const resolved = tryResolveFile(abs, ctx.root);
        if (resolved) {
          result = { kind: "file", filePath: resolved, specifier: specRaw };
        } else {
          const aliasAbs = fileExists(abs) ? path.resolve(abs) : null;
          if (aliasAbs) {
            result = { kind: "file", filePath: aliasAbs, specifier: specRaw };
          } else {
            result = { kind: "alias", specifier: specRaw };
          }
        }
        ctx.memo.set(memoKey, result);
        return result;
      }
    }

    if (spec.startsWith("#")) {
      result = { kind: "unresolved", specifier: specRaw };
    } else if (spec.startsWith("@")) {
      // Pseudo-scoped specifier that matched no alias: fall back to
      // workspace/package resolution (monorepo imports).
      result = resolveBareSpecifier(spec, ctx);
    } else {
      const base = spec.startsWith("/")
        ? path.join(ctx.root, spec.slice(1))
        : path.resolve(path.dirname(importerAbs), spec);
      const resolved = tryResolveFile(base, ctx.root);
      if (resolved) {
        result = { kind: "file", filePath: resolved, specifier: specRaw };
      } else {
        result = { kind: "unresolved", specifier: specRaw };
      }
    }
  } else {
    result = resolveBareSpecifier(spec, ctx);
  }

  ctx.memo.set(memoKey, result);
  return result;
}

function resolveBareSpecifier(spec: string, ctx: ResolverContext): ResolvedImport {
  // Bare specifier: workspace package? resolve its entry file so the graph
  // gets real edges. Otherwise it is a plain package name.
  const workspaceDir = ctx.workspaceNames.get(spec);
  if (workspaceDir) {
    const entry = resolveWorkspaceEntry(workspaceDir);
    if (entry) {
      return { kind: "file", filePath: entry, packageName: spec, specifier: spec };
    }
    return { kind: "package", packageName: spec, specifier: spec };
  }
  const parts = spec.startsWith("@") ? spec.split("/").slice(0, 2) : [spec.split("/")[0]!];
  const pkgName = parts.join("/");
  return { kind: "package", packageName: pkgName, specifier: spec };
}

/* ------------------------------------------------------------------ */
/* Alias map extraction from tsconfig / bundler configs               */
/* ------------------------------------------------------------------ */

function loadJsonText(file: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function aliasesFromTsconfig(tsconfigPath: string, root: string): AliasMap[] {
  const json = loadJsonText(tsconfigPath);
  if (!json) return [];
  const out: AliasMap[] = [];
  const compilerOptions = (json["compilerOptions"] ?? {}) as Record<string, unknown>;
  const paths = compilerOptions["paths"];
  if (!paths || typeof paths !== "object") return out;
  const baseUrl =
    typeof compilerOptions["baseUrl"] === "string"
      ? path.resolve(root, compilerOptions["baseUrl"] as string)
      : path.dirname(tsconfigPath);
  for (const [key, targets] of Object.entries(paths as Record<string, unknown>)) {
    const arr = Array.isArray(targets) ? targets : [targets];
    for (const t of arr) {
      if (typeof t !== "string") continue;
      const hasStar = key.includes("*");
      out.push({ from: key, to: path.resolve(baseUrl, t), hasStar });
    }
  }
  return out;
}

/** Extract `alias` entries from vite/webpack style configs via AST, with a
 * regex fallback for exotic formats. */
export function aliasesFromBundlerConfig(configPath: string, root: string): AliasMap[] {
  const out: AliasMap[] = [];
  let text = "";
  try {
    text = fs.readFileSync(configPath, "utf8");
  } catch {
    return out;
  }

  const sourceFile = ts.createSourceFile(configPath, text, ts.ScriptTarget.Latest, true);
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAssignment(node) && node.name.getText(sourceFile) === "alias") {
      const init = node.initializer;
      if (ts.isObjectLiteralExpression(init)) {
        for (const prop of init.properties) {
          if (!ts.isPropertyAssignment(prop)) continue;
          const key =
            ts.isStringLiteral(prop.name) || ts.isIdentifier(prop.name) || ts.isNumericLiteral(prop.name)
              ? prop.name.text
              : null;
          if (!key) continue;
          const val = prop.initializer;
          if (ts.isStringLiteral(val)) {
            out.push({ from: key, to: toAbsolute(root, val.text), hasStar: key.includes("*") });
          } else if (ts.isCallExpression(val)) {
            // path.resolve(__dirname, "src") style targets
            const fn = val.expression.getText(sourceFile);
            if (!/(^|[.])resolve$|(^|[.])join$/.test(fn)) continue;
            const parts: string[] = [];
            let ok = true;
            for (const arg of val.arguments) {
              if (ts.isStringLiteral(arg)) {
                parts.push(arg.text);
              } else if (ts.isTemplateExpression(arg)) {
                const tp = templateLiteralParts(arg, sourceFile);
                if (!tp) {
                  ok = false;
                  break;
                }
                parts.push(...tp);
              } else if (arg.getText(sourceFile) === "__dirname") {
                // __dirname anchors the path at the project root
              } else {
                ok = false;
                break;
              }
            }
            if (ok && parts.length > 0) {
              out.push({ from: key, to: path.resolve(root, ...parts), hasStar: key.includes("*") });
            }
          } else if (ts.isObjectLiteralExpression(val)) {
            let find: string | undefined;
            let replacement: string | undefined;
            for (const p of val.properties) {
              if (!ts.isPropertyAssignment(p)) continue;
              const k = p.name.getText(sourceFile).replace(/["']/g, "");
              if (k === "find" && ts.isStringLiteral(p.initializer)) find = p.initializer.text;
              if (k === "replacement" && ts.isStringLiteral(p.initializer)) replacement = p.initializer.text;
            }
            if (find && replacement) {
              out.push({ from: find, to: toAbsolute(root, replacement), hasStar: find.includes("*") || replacement.includes("*") });
            }
          } else if (ts.isArrayLiteralExpression(val)) {
            for (const el of val.elements) {
              if (!ts.isStringLiteral(el)) continue;
              out.push({
                from: key,
                to: toAbsolute(root, el.text),
                hasStar: key.includes("*"),
              });
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  if (out.length > 0) return out;

  // Regex fallback: alias: { 'x': 'path', find/replacement: {...} }
  const blockRe = /alias\s*:\s*\{([\s\S]*?)\}/g;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(text)) !== null) {
    const body = m[1] ?? "";
    // resets a state machine is unnecessary; match simple key: 'value' pairs
    const pairRe = /['"]([^'"]+)['"]\s*:\s*['"]([^'"]+)['"]/g;
    let p: RegExpExecArray | null;
    while ((p = pairRe.exec(body)) !== null) {
      out.push({ from: p[1]!, to: toAbsolute(root, p[2]!), hasStar: p[1]!.includes("*") });
    }
  }
  return out;
}

function templateLiteralParts(
  t: ts.TemplateExpression,
  sourceFile: ts.SourceFile,
): string[] | null {
  const out: string[] = [];
  if (t.head.text.length > 0) out.push(t.head.text);
  for (const span of t.templateSpans) {
    if (span.expression.getText(sourceFile) !== "__dirname") return null;
    if (span.literal.text.length > 0) out.push(span.literal.text);
  }
  return out;
}

function toAbsolute(root: string, target: string): string {
  if (path.isAbsolute(target)) return target;
  if (target.startsWith(".")) return path.resolve(root, target);
  // Alias targets that are bare package names cannot be resolved as files.
  return target;
}

/* ------------------------------------------------------------------ */
/* tsconfig discovery                                                  */
/* ------------------------------------------------------------------ */

const tsconfigNames = ["tsconfig.json", "jsconfig.json"];

export function findTsconfigForFile(root: string, fileAbs: string): AliasMap[] {
  let dir = path.dirname(fileAbs);
  const rootResolved = path.resolve(root);
  const stops = new Set<string>();
  for (;;) {
    for (const name of tsconfigNames) {
      const candidate = path.join(dir, name);
      if (fileExists(candidate)) {
        return aliasesFromTsconfig(candidate, dir);
      }
    }
    stops.add(dir);
    const parent = path.dirname(dir);
    if (parent === dir || parent.length < rootResolved.length) break;
    dir = parent;
  }
  return [];
}

export function discoverAliasMaps(root: string, allFiles: string[]): AliasMap[] {
  const out: AliasMap[] = [];
  const configs = allFiles.filter(
    (f) =>
      /(^|\/)tsconfig\.json$/.test(f) ||
      /(^|\/)jsconfig\.json$/.test(f) ||
      /(^|\/)(vite|vitest|webpack|nuxt|svelte)\.config\.(js|cjs|mjs|ts|mts|cts)$/.test(f) ||
      /(^|\/)webpack\.config\.js$/.test(f),
  );
  for (const rel of configs) {
    const abs = path.join(root, rel);
    if (/(^|\/)(tsconfig|jsconfig)\.json$/.test(rel)) {
      out.push(...aliasesFromTsconfig(abs, path.dirname(abs)));
    } else {
      out.push(...aliasesFromBundlerConfig(abs, root));
    }
  }
  return out;
}

/**
 * Expands a glob pattern (as used by Vite `import.meta.glob`) into matching
 * file paths relative to the project root.
 */
export function expandGlobPattern(pattern: string, root: string): string[] {
  const idx = pattern.indexOf("*");
  let baseDir = pattern;
  if (idx !== -1) {
    const before = pattern.slice(0, idx);
    const slashBefore = before.lastIndexOf("/");
    baseDir = slashBefore === -1 ? "" : before.slice(0, slashBefore);
  } else {
    baseDir = pattern.replace(/\/[^/]*$/, "");
  }
  const base = path.isAbsolute(pattern) ? pattern : path.join(root, baseDir);
  const re = globToRegExp(pattern.startsWith("/") ? pattern.slice(1) : pattern);
  let files: string[] = [];
  try {
    files = walkFiles(root, {
      matcher: createIgnoreMatcher([]),
      extensions: [".ts", ".tsx", ".js", ".jsx", ".vue", ".mjs", ".cjs"],
    });
  } catch {
    return [];
  }
  return files
    .filter((f) => re.test(f))
    .map((f) => path.join(root, f))
    .filter((f) => {
      void base;
      return fileExists(f);
    });
}

export function globToRegExp(pattern: string): RegExp {
  let out = "";
  let i = 0;
  const chars = pattern.split("");
  while (i < chars.length) {
    const c = chars[i]!;
    if (c === "*") {
      if (chars[i + 1] === "*") {
        if (chars[i + 2] === "/") {
          out += "(?:.*/)?";
          i += 3;
          continue;
        }
        out += ".*";
        i += 2;
        continue;
      }
      out += "[^/]*";
      i += 1;
      continue;
    }
    if (c === "?") {
      out += "[^/]";
      i += 1;
      continue;
    }
    out += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    i += 1;
  }
  return new RegExp("^" + out.replace(/^\^/, "") + "$");
}