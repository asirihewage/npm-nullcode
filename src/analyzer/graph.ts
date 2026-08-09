import * as path from "node:path";
import type { AstSummary, ResolvedImport } from "../types/index.js";
import { resolveImport, type ResolverContext } from "./resolver.js";

export interface FileNode {
  abs: string;
  imports: Map<string, ResolvedImport>;
  packages: Set<string>;
  importedBy: Set<string>;
  dynamicImporters: Set<string>;
  matchGlob: Set<string>;
  importersByExport: Map<string, Set<string>>;
  namespaceImporters: Set<string>;
  importersRequestingDefault: Set<string>;
  hardImportedBy: Set<string>;
}

export interface ImportGraph {
  files: Map<string, FileNode>;
  /** Map of file -> file (or package) reference info */
  packageUsage: Map<string, Set<string>>;
}

export function buildImportGraph(
  summariesByFile: Map<string, AstSummary>,
  resolver: ResolverContext,
): ImportGraph {
  const files = new Map<string, FileNode>();
  const packageUsage = new Map<string, Set<string>>();

  const ensureFile = (abs: string): FileNode => {
    let node = files.get(abs);
    if (!node) {
      node = {
        abs,
        imports: new Map(),
        packages: new Set(),
        importedBy: new Set(),
        dynamicImporters: new Set(),
        matchGlob: new Set(),
        importersByExport: new Map(),
        namespaceImporters: new Set(),
        importersRequestingDefault: new Set(),
        hardImportedBy: new Set(),
      };
      files.set(abs, node);
    }
    return node;
  };

  for (const [fileAbs, summary] of summariesByFile) {
    const node = ensureFile(fileAbs);
    for (const ref of summary.imports) {
      node.imports.set(ref.specifier, resolveImport(ref.specifier, fileAbs, resolver));
      const resolved = node.imports.get(ref.specifier);
      if (!resolved) continue;
      if (resolved.kind === "file" && resolved.filePath) {
        const target = ensureFile(resolved.filePath);
        const isDynamic = ref.kind === "dynamic";
        (isDynamic ? target.dynamicImporters : target.hardImportedBy).add(fileAbs);
        // A named/namespace import records the requested export names.
        if (!isDynamic) {
          if (ref.requested.includes("*")) {
            target.namespaceImporters.add(fileAbs);
          } else {
            for (const name of ref.requested) {
              if (name === "default") target.importersRequestingDefault.add(fileAbs);
              else {
                let set = target.importersByExport.get(name);
                if (!set) {
                  set = new Set();
                  target.importersByExport.set(name, set);
                }
                set.add(fileAbs);
              }
            }
          }
        }
        target.importedBy.add(fileAbs);
      } else if (resolved.kind === "package" && resolved.packageName) {
        node.packages.add(resolved.packageName);
        let usages = packageUsage.get(resolved.packageName);
        if (!usages) {
          usages = new Set();
          packageUsage.set(resolved.packageName, usages);
        }
        usages.add(fileAbs);
      }
    }
    for (const spec of summary.reexports) {
      const resolved = resolveImport(spec, fileAbs, resolver);
      if (resolved.kind === "file" && resolved.filePath) {
        const target = ensureFile(resolved.filePath);
        target.namespaceImporters.add(fileAbs);
        target.importedBy.add(fileAbs);
        target.hardImportedBy.add(fileAbs);
      } else if (resolved.kind === "package" && resolved.packageName) {
        let usages = packageUsage.get(resolved.packageName);
        if (!usages) {
          usages = new Set();
          packageUsage.set(resolved.packageName, usages);
        }
        usages.add(fileAbs);
      }
    }
  }

  // Match glob patterns last so all files exist in the graph already.
  for (const [fileAbs, summary] of summariesByFile) {
    for (const pattern of summary.globPatterns) {
      for (const matched of matchGlob(pattern, resolver.root, [...files.keys()])) {
        const target = ensureFile(matched);
        target.matchGlob.add(fileAbs);
        target.importedBy.add(fileAbs);
        target.dynamicImporters.add(fileAbs);
      }
    }
  }

  return { files, packageUsage };
}

export function matchGlob(pattern: string, root: string, allFiles: string[]): string[] {
  const normalized = pattern.split("\\").join("/");
  const re = globToRegExp(normalized);
  const out: string[] = [];
  for (const abs of allFiles) {
    const rel = path.relative(root, abs).split("\\").join("/");
    if (re.test(rel) || re.test(path.basename(abs))) out.push(abs);
  }
  return out;
}

function globToRegExp(pattern: string): RegExp {
  let out = "";
  let i = 0;
  const chars = pattern.split("");
  while (i < chars.length) {
    const c = chars[i];
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
  return new RegExp("^" + out + "$");
}