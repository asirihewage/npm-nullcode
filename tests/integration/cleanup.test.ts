import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { analyzeProject } from "../../src/analyzer/index.js";
import { detectCandidates } from "../../src/candidates/index.js";
import { buildCleanupPlan, persistPlan, persistScanResult, stateDir } from "../../src/cleanup/plan.js";
import { applyPlan, restoreBackup } from "../../src/cleanup/apply.js";
import { copyFixtureToTemp, readJson } from "../helpers.js";

describe("cleanup plan + apply", () => {
  it("creates a plan, backs everything up, applies changes and can restore", async () => {
    const root = copyFixtureToTemp("fixture-unused-dependency");
    const pkgJsonPath = path.join(root, "package.json");

    const ctx = await analyzeProject({ root, enableCache: false });
    const detect = await detectCandidates(ctx);
    expect(detect.candidates.length).toBeGreaterThan(0);

    const result = {
      tool: "nullcode",
      version: "0.1.0",
      rootDir: root,
      framework: ctx.framework,
      ai: { used: false },
      stats: {
        files: ctx.files.length,
        sourceFiles: 0,
        dependencies: ctx.pkgNames.size,
        imports: 0,
        configReferences: 0,
        git: false,
      },
      candidates: detect.candidates,
      duplicates: detect.duplicates,
      warnings: detect.warnings,
      infoMessages: detect.infoMessages,
    };

    await persistScanResult(root, result);
    const plan = buildCleanupPlan(result, root, { threshold: 60, dryRun: false });
    await persistPlan(root, plan);
    expect(plan.items.some((i) => i.packageName === "lodash")).toBe(true);
    expect(plan.items.some((i) => i.name === "src/util.js")).toBe(true);
    expect(fs.existsSync(path.join(stateDir(root), "scan-results.json"))).toBe(true);
    expect(fs.existsSync(path.join(stateDir(root), "cleanup-plan.json"))).toBe(true);

    const outcome = await applyPlan(root, plan);
    expect(outcome.removed.length).toBe(plan.items.length);

    // dependency removed from package.json, axios preserved
    const pkgAfter = readJson(pkgJsonPath);
    expect(pkgAfter["dependencies"]).not.toHaveProperty("lodash");
    expect((pkgAfter["dependencies"] as Record<string, string>)["axios"]).toBeDefined();
    // file moved out of src/ into backup
    expect(fs.existsSync(path.join(root, "src", "util.js"))).toBe(false);
    const backupFiles = fs.readdirSync(path.join(outcome.backupPath, "files"));
    expect(backupFiles).toContain("src");

    // restore everything
    const restored = await restoreBackup(root, outcome.backupPath);
    expect(restored).toBeGreaterThanOrEqual(2);
    expect(fs.existsSync(path.join(root, "src", "util.js"))).toBe(true);
    const pkgRestored = readJson(pkgJsonPath);
    expect((pkgRestored["dependencies"] as Record<string, string>)["lodash"]).toBeDefined();
  });

  it("keeps low-confidence candidates out of the plan by default", async () => {
    const root = copyFixtureToTemp("fixture-unused-env");
    const ctx = await analyzeProject({ root, enableCache: false });
    const detect = await detectCandidates(ctx);
    const result = {
      tool: "nullcode",
      version: "0.1.0",
      rootDir: root,
      framework: ctx.framework,
      ai: { used: false },
      stats: { files: 0, sourceFiles: 0, dependencies: 0, imports: 0, configReferences: 0, git: false },
      candidates: detect.candidates,
      duplicates: detect.duplicates,
      warnings: detect.warnings,
      infoMessages: detect.infoMessages,
    };
    const plan = buildCleanupPlan(result, root, { threshold: 90, dryRun: true });
    expect(plan.items.every((i) => i.confidence >= 90)).toBe(true);
    expect(plan.skipped.length).toBeGreaterThan(0);
  });
});