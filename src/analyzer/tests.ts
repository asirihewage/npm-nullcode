import * as path from "node:path";

/**
 * Test discovery: which files are tests (auto-run by the test runner) and
 * which are test utilities. Test runner globs make the whole graph treat
 * test files as entry points.
 */

export interface TestPatterns {
  testFiles: Set<string>;
  testUtils: Set<string>;
}

const TEST_BASENAME_RE = /\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/i;
const TEST_DIR_RE = /(^|\/)(__tests__|tests?|e2e|integration|spec|cypress|playwright)(\/|$)/i;
const TEST_UTIL_RE = /(^|\/)(test-utils?|__mocks__|mocks?)(\/|$)/i;

export function isTestFile(rel: string): boolean {
  return TEST_BASENAME_RE.test(path.basename(rel)) || TEST_DIR_RE.test(rel);
}

export function isTestUtility(rel: string): boolean {
  return TEST_UTIL_RE.test(rel) || /\btest(ing)?-[a-z-]+\.(ts|tsx|js|jsx)$/.test(path.basename(rel));
}

/**
 * A file that lives in a test directory (so the runner won't execute it) but
 * is not itself a conventional test file and imports nothing — an orphaned
 * helper. Broader than isTestUtility (catches e.g. tests/legacyThing.ts).
 */
export function isTestOrphan(rel: string): boolean {
  const base = path.basename(rel);
  if (TEST_BASENAME_RE.test(base)) return false;
  return TEST_DIR_RE.test(rel);
}

export function classifyTests(
  files: Array<{ abs: string; rel: string }>,
): TestPatterns {
  const testFiles = new Set<string>();
  const testUtils = new Set<string>();
  for (const f of files) {
    if (isTestUtility(f.rel)) {
      testUtils.add(f.abs);
      if (isTestFile(f.rel)) testFiles.add(f.abs);
    } else if (isTestFile(f.rel)) {
      testFiles.add(f.abs);
    }
  }
  return { testFiles, testUtils };
}

/**
 * Whether a test file is registered with the runner (e.g. via `testMatch`,
 * `include`, `roots`). Conservative: by default we treat conventional
 * locations as registered, which prevents false-positive removal.
 */
export function isRegisteredTest(
  rel: string,
  patterns: string[],
): boolean {
  if (patterns.length === 0) return true;
  const base = path.basename(rel);
  for (const p of patterns) {
    const re = globToRegExp(p);
    if (re.test(rel) || re.test(base)) return true;
  }
  return false;
}

function globToRegExp(pattern: string): RegExp {
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
  return new RegExp("^" + out + "$");
}