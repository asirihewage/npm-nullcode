/**
 * A gitignore-style pattern matcher used for `.nullcodeignore` files and the
 * `ignore` option. Supports the common gitignore semantics:
 *
 * - `#` comments, blank lines
 * - `!` negation
 * - trailing `/` marks directory-only patterns
 * - `/`-anchored patterns are relative to the root
 * - unanchored patterns match basenames at any depth
 * - `*`, `?`, `**` globbing
 */

export interface IgnoreMatcher {
  ignores(relPath: string, isDir: boolean): boolean;
}

function globToRegExp(pattern: string): RegExp {
  let out = "";
  let i = 0;
  const chars = pattern.split("");
  while (i < chars.length) {
    const c = chars[i]!;
    if (c === "*") {
      if (chars[i + 1] === "*") {
        const next = chars[i + 2];
        if (next === "/") {
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
    if (c === "\\") {
      const nx = chars[i + 1];
      if (nx !== undefined) {
        out += "\\" + nx;
        i += 2;
        continue;
      }
    }
    out += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    i += 1;
  }
  return new RegExp("^" + out + "$");
}

export interface CompiledPattern {
  regex: RegExp;
  dirOnly: boolean;
  baseOnly: boolean;
  negated: boolean;
  /** For patterns ending in "/**": the subtree root to also match itself. */
  tree: string | null;
}

export function compilePattern(line: string): CompiledPattern | null {
  let pattern = line.trim();
  if (pattern.length === 0 || pattern.startsWith("#")) return null;
  let negated = false;
  if (pattern.startsWith("!")) {
    negated = true;
    pattern = pattern.slice(1).trim();
  }
  if (pattern.length === 0) return null;
  let dirOnly = false;
  if (pattern.endsWith("/")) {
    dirOnly = true;
    pattern = pattern.slice(0, -1);
  }
  // Escaped leading '#' or '!'
  if (pattern.startsWith("\\#") || pattern.startsWith("\\!")) {
    pattern = pattern.slice(1);
  }
  const hadSlash = pattern.includes("/");
  if (pattern.startsWith("/")) pattern = pattern.slice(1);
  // Patterns without a slash match against the basename at any depth.
  const baseOnly = !hadSlash;
  // "dir/**" conventionally matches everything inside dir, and — since our
  // walker prunes ignored directories — the directory itself.
  let tree: string | null = null;
  if (!baseOnly && pattern.endsWith("/**")) {
    tree = pattern.slice(0, -3);
  }
  const regex = globToRegExp(pattern);
  return { regex, dirOnly, baseOnly, negated, tree };
}

export function isIgnored(
  patterns: CompiledPattern[],
  relPath: string,
  isDir: boolean,
): boolean {
  const normalized = relPath.split("\\").join("/").replace(/\/+$/, "");
  const segs = normalized.split("/");
  let ignored = false;
  for (const p of patterns) {
    let primary = false;
    if (p.baseOnly) {
      primary = p.regex.test(segs.at(-1) ?? "");
    } else if (p.tree) {
      primary =
        normalized === p.tree ||
        normalized.startsWith(p.tree + "/") ||
        p.regex.test(normalized);
    } else {
      primary = p.regex.test(normalized);
    }
    if (primary && p.dirOnly && !isDir) primary = false;
    // A pattern that matches a directory also excludes everything under it.
    let subtree = false;
    if (!primary) {
      if (p.baseOnly) {
        subtree = segs.slice(0, -1).some((seg) => p.regex.test(seg));
      } else {
        for (let i = 1; i < segs.length; i++) {
          if (p.regex.test(segs.slice(0, i).join("/"))) {
            subtree = true;
            break;
          }
        }
      }
    }
    if (primary || subtree) ignored = !p.negated;
  }
  return ignored;
}

export function compileIgnorePatterns(lines: string[]): CompiledPattern[] {
  const out: CompiledPattern[] = [];
  for (const line of lines) {
    const compiled = compilePattern(line);
    if (compiled) out.push(compiled);
  }
  return out;
}

export function createIgnoreMatcher(lines: string[]): IgnoreMatcher {
  const patterns = compileIgnorePatterns(lines);
  return {
    ignores(relPath, isDir) {
      return isIgnored(patterns, relPath, isDir);
    },
  };
}

/**
 * Merges a set of ignore sources with the defaults nullcode always applies.
 */
export function mergeIgnoreLines(extra: string[]): string[] {
  const defaults = [
    "node_modules/**",
    ".git/**",
    "dist/**",
    "build/**",
    ".next/**",
    ".nuxt/**",
    ".output/**",
    ".cache/**",
    "coverage/**",
    ".turbo/**",
    ".yarn/**",
    ".pnpm-store/**",
    ".nullcode/**",
    ".nullcode-cache/**",
    "out/**",
    "target/**",
    "*.min.js",
    ".venv/**",
    "tmp/**",
    ".tmp/**",
    ".swc/**",
  ];
  return [...defaults, ...extra];
}