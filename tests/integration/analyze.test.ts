import { describe, expect, it } from "vitest";
import { analyzeProject } from "../../src/analyzer/index.js";
import { detectCandidates } from "../../src/candidates/index.js";
import type { Candidate } from "../../src/types/index.js";
import { copyFixtureToTemp } from "../helpers.js";

async function scanFixture(name: string) {
  const root = copyFixtureToTemp(name);
  const ctx = await analyzeProject({ root, enableCache: false });
  const result = await detectCandidates(ctx);
  return { root, ctx, result };
}

function names(result: { candidates: Candidate[] }, type?: string) {
  return result.candidates
    .filter((c) => (type ? c.type === type : true))
    .map((c) => c.name);
}

function pick(result: { candidates: Candidate[] }, name: string): Candidate | undefined {
  return result.candidates.find((c) => c.name === name);
}

describe("fixture-unused-dependency", () => {
  it("flags lodash with high confidence and leaves axios/eslint alone", async () => {
    const { result } = await scanFixture("fixture-unused-dependency");
    const lodash = pick(result, "lodash");
    expect(lodash).toBeDefined();
    expect(lodash!.confidence).toBeGreaterThanOrEqual(60);
    expect(lodash!.evidence.imports).toBe(0);
    expect(pick(result, "axios")).toBeUndefined();
    expect(pick(result, "eslint")).toBeUndefined();
  });

  it("flags dead source files but not entry files", async () => {
    const { result } = await scanFixture("fixture-unused-dependency");
    const ul = names(result, "source_file");
    expect(ul).toContain("src/util.js");
    expect(ul).not.toContain("src/index.js");
  });
});

describe("fixture-used-dependency", () => {
  it("produces no candidates for used packages or entry files", async () => {
    const { result } = await scanFixture("fixture-used-dependency");
    expect(resultsAllNames(result)).not.toContain("moment");
    expect(resultsAllNames(result)).not.toContain("express");
  });
});

describe("fixture-dynamic-import", () => {
  it("flags template-driven route files as REVIEW, not SAFE", async () => {
    const { result } = await scanFixture("fixture-dynamic-import");
    const alpha = pick(result, "src/pages/alpha.js");
    const beta = pick(result, "src/pages/beta.js");
    expect(alpha).toBeDefined();
    expect(alpha!.category).toBe("REVIEW_REQUIRED");
    expect(beta!.category).toBe("REVIEW_REQUIRED");
    // dynamic import of a package counts as real usage
    expect(pick(result, "moment")).toBeUndefined();
  });
});

describe("fixture-nextjs", () => {
  it("never flags framework-managed files or implicit packages", async () => {
    const { ctx, result } = await scanFixture("fixture-nextjs");
    expect(ctx.framework).toBe("next");
    const namesAll = resultsAllNames(result);
    expect(namesAll).not.toContain("next");
    expect(namesAll).not.toContain("react");
    expect(namesAll).not.toContain("react-dom");
    expect(namesAll).not.toContain("app/page.tsx");
    expect(namesAll).not.toContain("app/layout.tsx");
    expect(namesAll).not.toContain("app/api/route.ts");
    expect(namesAll).not.toContain("middleware.ts");
    expect(namesAll).not.toContain("next.config.mjs");
    expect(namesAll).toContain("lodash");
    expect(namesAll).toContain("src/legacy.ts");
  });
});

describe("fixture-react", () => {
  it("credits JSX-based frameworks and flags only true orphans", async () => {
    const { ctx, result } = await scanFixture("fixture-react");
    expect(ctx.framework).toBe("react");
    const namesAll = resultsAllNames(result);
    expect(namesAll).not.toContain("react");
    expect(namesAll).not.toContain("react-dom");
    expect(namesAll).not.toContain("src/App.tsx");
    expect(namesAll).not.toContain("src/components/Button.tsx");
    expect(namesAll).not.toContain("src/main.tsx");
    expect(namesAll).toContain("classnames");
    expect(namesAll).toContain("src/components/UnusedButton.tsx");
  });
});

describe("fixture-vite", () => {
  it("resolves aliases, honors glob-matched views and flags only unmatched work", async () => {
    const { ctx, result } = await scanFixture("fixture-vite");
    expect(ctx.framework).toBe("vite");
    const namesAll = resultsAllNames(result);
    expect(namesAll).not.toContain("vite");
    expect(namesAll).not.toContain("vue");
    expect(namesAll).not.toContain("src/api.ts");
    expect(namesAll).not.toContain("src/views/known/a.vue");
    expect(namesAll).toContain("src/views/unknown/b.vue");
  });
});

describe("fixture-webpack", () => {
  it("treats webpack entry + alias-resolved imports as used", async () => {
    const { result } = await scanFixture("fixture-webpack");
    const namesAll = resultsAllNames(result);
    expect(namesAll).not.toContain("webpack");
    expect(namesAll).not.toContain("src/util.js");
    expect(namesAll).not.toContain("src/index.js");
    expect(namesAll).toContain("lodash");
    expect(namesAll).toContain("src/unused.js");
  });
});

describe("fixture-unused-env", () => {
  it("flags defined-but-unused and example-only vars but not platform vars", async () => {
    const { result } = await scanFixture("fixture-unused-env");
    const envCandidates = result.candidates.filter((c) => c.type.startsWith("env_"));
    const envNames = envCandidates.map((c) => c.name);
    expect(envNames).toContain("DEBUG_MODE");
    expect(envNames).toContain("ENABLE_LEGACY_SEARCH");
    expect(envNames).not.toContain("API_URL");
    expect(envNames).not.toContain("NODE_ENV");
    expect(envNames).not.toContain("CI");
  });
});

describe("fixture-unused-config", () => {
  it("flags configs whose tools are absent, keeps live ones, spots legacy duplicates", async () => {
    const { result } = await scanFixture("fixture-unused-config");
    const configCandidates = result.candidates.filter((c) => c.type === "config_file");
    const names = configCandidates.map((c) => c.name);
    expect(names).toContain("vite.config.ts");
    expect(names).toContain("jest.config.js");
    expect(names).toContain(".eslintrc.json");
    expect(names).not.toContain("eslint.config.mjs");
    expect(names).not.toContain("webpack.config.js");
  });
});

describe("fixture-dead-export", () => {
  it("flags only exports that are never imported", async () => {
    const { result } = await scanFixture("fixture-dead-export");
    const exports = result.candidates.filter((c) => c.type === "unused_export");
    const names = exports.map((c) => c.name);
    expect(names).toContain("src/lib/math.ts#sub");
    expect(names).toContain("src/lib/math.ts#multiply");
    expect(names).not.toContain("src/lib/math.ts#add");
    expect(exports[0]!.confidence).toBeGreaterThanOrEqual(60);
  });
});

describe("fixture-framework-entrypoint", () => {
  it("honors script-declared entry points", async () => {
    const { result } = await scanFixture("fixture-framework-entrypoint");
    const namesAll = resultsAllNames(result);
    expect(namesAll).not.toContain("src/server.js");
    expect(namesAll).not.toContain("bin/cli.js");
    expect(namesAll).not.toContain("lib/run.js");
    expect(namesAll).not.toContain("src/routes.js");
    expect(namesAll).toContain("src/legacy-one.js");
  });
});

describe("fixture-monorepo", () => {
  it("never flags cross-package imports even when the importer is elsewhere", async () => {
    const { result } = await scanFixture("fixture-monorepo");
    const depCandidates = result.candidates.filter((c) => c.packageName);
    const depNames = depCandidates.map((c) => c.packageName);
    expect(depNames).toContain("clipboard");
    expect(depNames).toContain("lodash");
    expect(depNames).not.toContain("@repo/a");
    expect(depNames).not.toContain("typescript");
  });
});

describe("fixture-generated-code", () => {
  it("never flags codegen output", async () => {
    const { result } = await scanFixture("fixture-generated-code");
    const namesAll = resultsAllNames(result);
    expect(namesAll).not.toContain("src/generated/types.ts");
    expect(namesAll).not.toContain("src/codegen-output/api.ts");
    expect(namesAll).toContain("src/manual.ts");
  });
});

describe("fixture-unused-test-util", () => {
  it("flags orphaned test utilities but not helpers used by tests", async () => {
    const { result } = await scanFixture("fixture-unused-test-util");
    const testCandidates = result.candidates.filter((c) => c.type === "test_util");
    const names = testCandidates.map((c) => c.name);
    expect(names).toContain("tests/legacyTestUtils.ts");
    expect(names).not.toContain("tests/helpers/makeTestData.ts");
    expect(names).not.toContain("tests/app.test.ts");
  });
});

describe("fixture-dead-code-cascade", () => {
  it("only flags the outermost dead module, not modules it imports", async () => {
    const { result } = await scanFixture("fixture-dead-code-cascade");
    const namesAll = resultsAllNames(result);
    expect(namesAll).toContain("src/App.tsx");
    expect(namesAll).not.toContain("src/helpers/old.ts");
    expect(namesAll).toContain("src/live.ts");
    // App.tsx imports helpers/old.ts, so old.ts is NOT dead from the graph
    const app = pick(result, "src/App.tsx");
    expect(app).toBeDefined();
  });
});

describe("fixture-dup-deps", () => {
  it("reports duplicate declarations and multi-version packages", async () => {
    const { result } = await scanFixture("fixture-dup-deps");
    const dupNames = result.duplicates.map((d) => d.package + "|" + d.detail);
    expect(dupNames.some((d) => d.startsWith("lodash|"))).toBe(true);
    expect(dupNames.filter((d) => d.startsWith("lodash|")).some((d) => d.includes("distinct versions") || d.includes("both dependencies and devDependencies"))).toBe(true);
  });
});

describe("fixture-css", () => {
  it("flags unreferenced stylesheets but not those linked from index.html", async () => {
    const { result } = await scanFixture("fixture-css");
    const css = result.candidates.filter((c) => c.type === "css_file");
    const names = css.map((c) => c.name);
    expect(names).toContain("src/styles/legacy.css");
    expect(names).toContain("src/styles/legacy.scss");
    expect(names).not.toContain("src/styles/main.css");
  });
});

function resultsAllNames(result: { candidates: Array<{ name: string }> }): string[] {
  return result.candidates.map((c) => c.name);
}