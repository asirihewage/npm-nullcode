import * as path from "node:path";
import ts from "typescript";
import type { AstSummary } from "../types/index.js";
import { analyzeAst, analyzeRegexFallback } from "./ast/index.js";
import type { IndexedFile } from "../types/index.js";
import { CONFIG_TOOL } from "./file-indexer.js";

export interface ConfigAnalysis {
  pkgUsage: Map<string, Set<string>>;
  fileUsage: Map<string, Set<string>>;
}

const QUOTED_RE = /["'`]([^"'`\\\n]{2,160})["'`]/g;

function collectStrings(raw: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = QUOTED_RE.exec(raw)) !== null) {
    out.push(m[1]!);
  }
  return out;
}

function collectIdentifiers(sourceFile: ts.SourceFile): string[] {
  const out = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) {
      out.add(node.text);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return [...out];
}

/**
 * Scans configuration files (vite/webpack/eslint/jest/... configs, CI files,
 * html entry files, css files) and records:
 *   - package names referenced (plugins, loaders, tool names)
 *   - file paths referenced (css @import, html <script src>, config fields)
 */
export function analyzeConfigFiles(
  files: IndexedFile[],
  texts: Map<string, string>,
  pkgNames: Set<string>,
): ConfigAnalysis {
  const pkgUsage = new Map<string, Set<string>>();
  const fileUsage = new Map<string, Set<string>>();
  const allAbs = new Set(files.map((f) => f.abs));

  const recordPkg = (pkg: string, file: string): void => {
    let set = pkgUsage.get(pkg);
    if (!set) {
      set = new Set();
      pkgUsage.set(pkg, set);
    }
    set.add(file);
  };
  const recordFile = (abs: string, file: string): void => {
    let set = fileUsage.get(abs);
    if (!set) {
      set = new Set();
      fileUsage.set(abs, set);
    }
    set.add(file);
  };

  for (const file of files) {
    if (
      file.kind !== "config" &&
      file.kind !== "html" &&
      file.kind !== "css" &&
      file.kind !== "json" &&
      file.kind !== "doc" &&
      file.kind !== "other"
    ) {
      continue;
    }
    const text = texts.get(file.abs) ?? "";
    if (text.length === 0) continue;

    // Package references from string literals and identifiers.
    const strings: string[] = [];
    const identifiers: string[] = [];
    if (file.kind === "config" && /\.(js|cjs|mjs|ts|mts|cts)$/.test(file.rel)) {
      const summary = analyzeAst(file.abs, text);
      for (const imp of summary.imports) {
        strings.push(imp.specifier);
      }
      for (const spec of summary.reexports) {
        strings.push(spec);
      }
      const sf = ts.createSourceFile(file.abs, text, ts.ScriptTarget.Latest, true);
      identifiers.push(...collectIdentifiers(sf));
      strings.push(...collectStrings(text));
    } else {
      strings.push(...collectStrings(text));
    }

    for (const s of strings) {
      const clean = s.trim();
      if (!clean) continue;
      if (clean.startsWith("./") || clean.startsWith("../")) {
        // file path reference (css import, html src, tailwind content, ...)
        const abs = path.resolve(path.dirname(file.abs), clean.replace(/\?.*$/, ""));
        const plain = abs.replace(/\.[a-z]+$/i, "");
        for (const candidate of allAbs) {
          const cplain = candidate.replace(/\.[a-z]+$/i, "");
          if (candidate === abs || cplain === plain) {
            recordFile(candidate, file.rel);
          }
        }
        continue;
      }
      if (clean.startsWith("node:")) continue;
      if (pkgNames.has(clean)) {
        recordPkg(clean, file.rel);
        continue;
      }
      const first = clean.split("/")[0]!;
      if (pkgNames.has(first)) recordPkg(first, file.rel);
      const scoped = clean.startsWith("@") ? clean.split("/").slice(0, 2).join("/") : first;
      if (scoped !== first && pkgNames.has(scoped)) recordPkg(scoped, file.rel);
    }

    for (const id of identifiers) {
      if (pkgNames.has(id)) recordPkg(id, file.rel);
    }
  }

  return { pkgUsage, fileUsage };
}

/** Which tool owns each config file (for "tool not installed" detection). */
export function configToolOwner(file: IndexedFile): string | null {
  const base = path.basename(file.rel);
  return CONFIG_TOOL[base] ?? null;
}

export function isLegacyConfig(file: IndexedFile, allConfigBasenames: Set<string>): boolean {
  const base = path.basename(file.rel);
  if (base === "babel.config.js" && file.rel.includes("webpack")) return false;
  if (base.startsWith(".eslintrc")) {
    for (const b of allConfigBasenames) {
      if (b.startsWith("eslint.config")) return true;
    }
    // eslintrc is only "legacy" if a flat config also exists
    return false;
  }
  return false;
}