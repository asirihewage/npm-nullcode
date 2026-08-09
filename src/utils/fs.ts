import * as fs from "node:fs";
import * as path from "node:path";
import type { IgnoreMatcher } from "./ignore.js";

export interface WalkOptions {
  matcher: IgnoreMatcher;
  extensions?: string[];
}

const SOURCE_EXTENSIONS = [
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
  ".vue",
];

const ALL_EXTENSIONS = [
  ...SOURCE_EXTENSIONS,
  ".css",
  ".scss",
  ".sass",
  ".less",
  ".html",
  ".htm",
  ".json",
  ".md",
  ".mdx",
  ".yml",
  ".yaml",
  ".toml",
  ".sh",
  ".ps1",
  ".env",
  ".txt",
  ".svg",
  ".xml",
  ".graphql",
  ".gql",
  ".proto",
  ".py",
];

/**
 * Recursively walks a directory tree, applying the ignore matcher to every
 * node (directories and files), returning relative posix paths.
 */
export function walkFiles(root: string, opts: WalkOptions): string[] {
  const out: string[] = [];
  const all = opts.extensions ?? ALL_EXTENSIONS;
  const allSet = new Set(all);

  const visit = (dir: string, relDir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const rel = relDir === "" ? entry.name : `${relDir}/${entry.name}`;
      if (opts.matcher.ignores(rel, entry.isDirectory())) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(abs, rel);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (allSet.has(ext) || allSet.has(entry.name)) {
          out.push(rel);
        }
      }
    }
  };

  visit(root, "");
  return out;
}

export function sourceExtensions(): string[] {
  return [...SOURCE_EXTENSIONS];
}

export function isSourceExt(ext: string): boolean {
  return SOURCE_EXTENSIONS.includes(ext);
}

export function relPosix(abs: string, root: string): string {
  return path.relative(root, abs).split("\\").join("/");
}

export function fileExists(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

export function dirExists(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

export function pathExists(p: string): boolean {
  try {
    fs.statSync(p);
    return true;
  } catch {
    return false;
  }
}