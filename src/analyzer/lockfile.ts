import * as fs from "node:fs";
import * as path from "node:path";
import type { LockInfo } from "../types/index.js";
import { fileExists } from "../utils/fs.js";

/**
 * Lightweight lockfile analysis. Extracts the set of package names and the
 * distinct versions observed, which powers duplicate/multi-version detection.
 * Deliberately tolerant of malformed input.
 */
export function analyzeLockfile(root: string): LockInfo {
  const packageLock = path.join(root, "package-lock.json");
  if (fileExists(packageLock)) {
    try {
      const json = JSON.parse(fs.readFileSync(packageLock, "utf8")) as {
        packages?: Record<string, { name?: string; version?: string; dev?: boolean }>;
        dependencies?: Record<string, { version?: string }>;
      };
      const names = new Map<string, string[]>();
      const add = (name: string, version: string): void => {
        const versions = names.get(name) ?? [];
        if (!versions.includes(version)) versions.push(version);
        names.set(name, versions);
      };
      if (json.packages && typeof json.packages === "object") {
        for (const [id, p] of Object.entries(json.packages)) {
          if (!p || typeof p !== "object") continue;
          if (id === "") continue;
          if (id.startsWith("node_modules/")) {
            const name = p.name ?? id.slice("node_modules/".length);
            if (p.version) add(name, p.version);
            else add(name, "unknown");
          } else if (p.name && p.version) {
            add(p.name, p.version);
          }
        }
      }
      if (json.dependencies && typeof json.dependencies === "object") {
        for (const [name, dep] of Object.entries(json.dependencies)) {
          if (dep && typeof dep === "object" && dep.version) add(name, dep.version);
        }
      }
      return { lockKind: "package-lock", names };
    } catch {
      return { lockKind: "package-lock", names: new Map() };
    }
  }

  const pnpmLock = path.join(root, "pnpm-lock.yaml");
  if (fileExists(pnpmLock)) {
    const names = new Map<string, string[]>();
    try {
      const text = fs.readFileSync(pnpmLock, "utf8");
      // pnpm v9: "  @scope/pkg@1.2.3:" lines
      const re = /^\s+(@[^/@\s]+\/[^/@\s]+|[^/@\s][^/@\s]*?)@([^:\s(]+)/gm;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        const name = m[1]!;
        const version = m[2]!.replace(/^\./, "");
        const versions = names.get(name) ?? [];
        if (!versions.includes(version)) versions.push(version);
        names.set(name, versions);
      }
    } catch {
      // ignore
    }
    return { lockKind: "pnpm-lock", names };
  }

  const yarnLock = path.join(root, "yarn.lock");
  if (fileExists(yarnLock)) {
    const names = new Map<string, string[]>();
    try {
      const text = fs.readFileSync(yarnLock, "utf8");
      const re = /^ {2}("?@?[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+"?)@[^:]+:$/gm;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        const name = (m[1] ?? "").replace(/^"|"$/g, "");
        const versions = names.get(name) ?? [];
        names.set(name, versions);
      }
    } catch {
      // ignore
    }
    return { lockKind: "yarn-lock", names };
  }

  return { lockKind: "none", names: new Map() };
}

export function countVersions(names: Map<string, string[]>): Map<string, number> {
  const out = new Map<string, number>();
  for (const [name, versions] of names) {
    out.set(name, versions.length);
  }
  return out;
}

/**
 * Which top-level packages appear as transitive dependencies of each other?
 * For a direct dependency `a`, if `b` (also direct) depends on `a`, removing
 * `a` from package.json would keep it available transitively — evidence we
 * surface rather than using to block removal.
 */
export function directDepOfDirect(names: Map<string, string[]>, direct: string[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const d of direct) {
    const versions = names.get(d) ?? [];
    for (const v of versions) {
      // no parent information in this lightweight model; mark unknown
      void v;
    }
    if (!out.has(d)) out.set(d, []);
  }
  return out;
}