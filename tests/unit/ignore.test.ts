import { describe, expect, it } from "vitest";
import {
  compileIgnorePatterns,
  createIgnoreMatcher,
  isIgnored,
  mergeIgnoreLines,
} from "../../src/utils/ignore.js";

describe("gitignore-style matcher", () => {
  it("matches basename patterns at any depth", () => {
    const matcher = createIgnoreMatcher(["generated/"]);
    expect(matcher.ignores("generated", true)).toBe(true);
    expect(matcher.ignores("src/generated", true)).toBe(true);
    expect(matcher.ignores("src/generated/types.ts", false)).toBe(true);
    expect(matcher.ignores("src/app.ts", false)).toBe(false);
  });

  it("anchored patterns are relative to the root", () => {
    const matcher = createIgnoreMatcher(["/vendor"]);
    expect(matcher.ignores("vendor", true)).toBe(true);
    expect(matcher.ignores("src/vendor", true)).toBe(false);
  });

  it("supports ** globs", () => {
    const matcher = createIgnoreMatcher(["src/generated/**"]);
    expect(matcher.ignores("src/generated/deep/file.ts", false)).toBe(true);
    expect(matcher.ignores("src/generated", true)).toBe(true);
    expect(matcher.ignores("generated/x.ts", false)).toBe(false);
  });

  it("supports negation", () => {
    const matcher = createIgnoreMatcher(["vendor/**", "!vendor/keep.js"]);
    expect(matcher.ignores("vendor/a.js", false)).toBe(true);
    expect(matcher.ignores("vendor/keep.js", false)).toBe(false);
  });

  it("handles comments and blank lines", () => {
    const matcher = createIgnoreMatcher(["# comment", "", "dist/"]);
    expect(matcher.ignores("dist", true)).toBe(true);
    expect(matcher.ignores("anything.ts", false)).toBe(false);
  });

  it("default ignores protect runtime/build artifacts", () => {
    const patterns = compileIgnorePatterns(mergeIgnoreLines([]));
    expect(isIgnored(patterns, "node_modules/lodash/index.js", false)).toBe(true);
    expect(isIgnored(patterns, ".git/config", false)).toBe(true);
    expect(isIgnored(patterns, "dist/bundle.js", false)).toBe(true);
    expect(isIgnored(patterns, "src/main.ts", false)).toBe(false);
  });
});