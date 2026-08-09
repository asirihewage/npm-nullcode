import * as fs from "node:fs";
import * as path from "node:path";
import type { ScriptInfo, WorkspaceInfo } from "../types/index.js";
import { dirExists, fileExists } from "../utils/fs.js";

const SKIP_TOKENS = new Set([
  "node",
  "npm",
  "npx",
  "yarn",
  "pnpm",
  "bun",
  "sh",
  "bash",
  "zsh",
  "fish",
  "cmd",
  "powershell",
  "pwsh",
  "mkdir",
  "rm",
  "rmdir",
  "cp",
  "mv",
  "echo",
  "cat",
  "sleep",
  "test",
  "true",
  "false",
  "exit",
  "cd",
  "touch",
  "sed",
  "awk",
  "grep",
  "find",
  "xargs",
  "env",
  "cross-env",
  "rimraf",
  "del",
  "if",
  "then",
  "else",
  "fi",
  "for",
  "done",
  "&&",
  "||",
  "&",
  ";",
  "(",
  ")",
]);

/** Splits a shell-ish command string into tokens, respecting quotes. */
export function tokenizeScript(script: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: string | null = null;
  for (let i = 0; i < script.length; i++) {
    const ch = script[i]!;
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += ch;
  }
  if (current) tokens.push(current);
  return tokens;
}

export function extractPathTokens(script: string, root: string): string[] {
  const tokens = tokenizeScript(script);
  const paths: string[] = [];
  for (const token of tokens) {
    const clean = token.replace(/^["']|["']$/g, "");
    if (clean.startsWith("./") || clean.startsWith("../") || clean.startsWith("/") || clean.startsWith("src/") || clean.startsWith("scripts/") || clean.startsWith("bin/")) {
      let abs = path.resolve(root, clean);
      if (!fileExists(abs)) {
        // `node src/app.ts` resolves from the workspace root
        abs = path.resolve(root, clean.replace(/^\.\//, ""));
      }
      if (fileExists(abs)) paths.push(abs);
    }
  }
  return paths;
}

/**
 * Well-known bin names per package, used when node_modules is not installed
 * (fallback so script-based usage detection still works for common tools).
 */
const KNOWN_BIN_FALLBACK: Record<string, string[]> = {
  typescript: ["tsc", "tsserver"],
  vite: ["vite"],
  vitest: ["vitest"],
  webpack: ["webpack"],
  "webpack-cli": ["webpack"],
  jest: ["jest"],
  eslint: ["eslint"],
  prettier: ["prettier"],
  esbuild: ["esbuild"],
  rollup: ["rollup"],
  next: ["next"],
  "ts-node": ["ts-node", "ts-node-esm", "ts-node-cwd"],
  nodemon: ["nodemon"],
  concurrently: ["concurrently"],
  rimraf: ["rimraf"],
  "cross-env": ["cross-env"],
  "@playwright/test": ["playwright"],
  playwright: ["playwright"],
  prisma: ["prisma"],
  turbo: ["turbo"],
  nx: ["nx"],
  expo: ["expo"],
  babel: ["babel", "babel-node"],
  "@babel/cli": ["babel"],
  tailwindcss: ["tailwindcss"],
  postcss: ["postcss"],
  sass: ["sass"],
  stylelint: ["stylelint"],
  "tsx": ["tsx"],
};

/**
 * Reads `bin` entries of installed packages (node_modules) to map binary
 * names used in scripts to their owning packages. Falls back to the package
 * name (last segment for scoped packages) when not installed.
 */
export function buildBinMap(
  root: string,
  pkgNames: string[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const name of pkgNames) {
    const pkgJsonPath = path.join(root, "node_modules", ...name.split("/"), "package.json");
    let bins: string[] = [];
    try {
      const json = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8")) as {
        bin?: string | Record<string, string>;
      };
      if (typeof json.bin === "string") bins = [json.bin];
      else if (json.bin && typeof json.bin === "object") bins = Object.keys(json.bin);
    } catch {
      // node_modules not installed (or package not installed)
      bins = KNOWN_BIN_FALLBACK[name] ?? [name.split("/").at(-1) ?? name];
    }
    if (bins.length === 0) bins = [name.split("/").at(-1) ?? name];
    for (const bin of bins) {
      if (!map.has(bin)) map.set(bin, name);
    }
  }
  return map;
}

export function analyzeScripts(
  workspace: WorkspaceInfo,
  binMap: Map<string, string>,
): Map<string, ScriptInfo> {
  const scripts = (workspace.pkgJson["scripts"] ?? {}) as Record<string, string>;
  if (typeof scripts !== "object" || scripts === null) return new Map();
  const out = new Map<string, ScriptInfo>();
  for (const [name, raw] of Object.entries(scripts)) {
    if (typeof raw !== "string") continue;
    const tokens = tokenizeScript(raw);
    const pkgUsage = new Map<string, number>();
    const fileUsage = new Set<string>();
    for (const token of tokens) {
      const clean = token.replace(/^["']|["']$/g, "");
      if (SKIP_TOKENS.has(clean)) continue;
      if (clean.includes("\\") || clean.includes("/")) {
        // Possibly a path (e.g. node ./scripts/x.js) or a subcommand of a pkg
        if (clean.startsWith(".") || path.isAbsolute(clean)) {
          const abs = path.resolve(workspace.dir, clean);
          if (fileExists(abs)) fileUsage.add(abs);
          continue;
        }
        const first = clean.split("/")[0]!;
        if (binMap.has(first)) {
          pkgUsage.set(binMap.get(first)!, (pkgUsage.get(binMap.get(first)!) ?? 0) + 1);
          continue;
        }
        // guess first segment package (e.g. webpack/bin/webpack.js)
        continue;
      }
      const owner = binMap.get(clean);
      if (owner) {
        pkgUsage.set(owner, (pkgUsage.get(owner) ?? 0) + 1);
      }
    }
    // npx <pkg> / yarn <pkg> handled above because tokens are processed
    // independently; `npx` is in SKIP_TOKENS.
    for (const p of extractPathTokens(raw, workspace.dir)) {
      fileUsage.add(p);
    }
    out.set(name, { name, value: raw, pkgUsage, fileUsage });
  }
  return out;
}

export function collectWorkspaces(
  root: string,
  workspacesField: string[] | { packages?: string[] } | undefined,
  pnpmWorkspaceYaml: string[] | undefined,
): string[] {
  const dirs = new Set<string>();
  const addGlobDirs = (patterns: string[]): void => {
    for (const p of patterns) {
      const clean = p.replace(/\/\*+$/, "").replace(/^\.\//, "");
      if (!clean || clean.startsWith("!")) continue;
      const dir = path.join(root, clean);
      if (dirExists(dir)) {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const candidate = path.join(dir, entry.name);
            if (fileExists(path.join(candidate, "package.json"))) {
              dirs.add(candidate);
            }
          }
        }
      }
    }
  };
  if (Array.isArray(workspacesField)) addGlobDirs(workspacesField);
  else if (workspacesField && typeof workspacesField === "object" && Array.isArray(workspacesField.packages)) {
    addGlobDirs(workspacesField.packages);
  }
  if (pnpmWorkspaceYaml && pnpmWorkspaceYaml.length > 0) {
    addGlobDirs(pnpmWorkspaceYaml);
  }
  return [...dirs];
}

export function readPnpmWorkspaces(root: string): string[] {
  const file = path.join(root, "pnpm-workspace.yaml");
  if (!fileExists(file)) return [];
  try {
    const text = fs.readFileSync(file, "utf8");
    const packages: string[] = [];
    let inPackages = false;
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed === "packages:") {
        inPackages = true;
        continue;
      }
      if (inPackages) {
        if (/^[a-z_]+:/.test(trimmed)) break;
        const m = /^-\s*["']?([^"']+)["']?$/.exec(trimmed);
        if (m) packages.push(m[1]!);
      }
    }
    return packages;
  } catch {
    return [];
  }
}