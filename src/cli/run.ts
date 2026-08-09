import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import { Command } from "commander";
import { runScan } from "../index.js";
import type { FrameworkName } from "../types/index.js";
import { mergeConfig } from "../config/load.js";
import { createLogger } from "../utils/logger.js";
import { renderTerminalReport, renderExplain } from "../reporters/terminal.js";
import { renderJsonReport } from "../reporters/json.js";
import { renderSarifReport } from "../reporters/sarif.js";
import { renderCiReport, evaluateCi } from "../reporters/ci.js";
import { buildCleanupPlan, persistPlan, persistScanResult, stateDir } from "../cleanup/plan.js";
import { applyPlan } from "../cleanup/apply.js";
import { runInteractiveRemoval } from "../cleanup/interactive.js";
import { ollamaSetupHint } from "../ai/ollama.js";
import type { Candidate } from "../types/index.js";

export interface RunCliOptions {
  tool: "scan" | "deps" | "files" | "config" | "env" | "explain" | "init";
  item?: string;
  positional?: string;
  argv: string[];
}

interface CliFlags {
  fix: boolean;
  interactive: boolean;
  json: boolean;
  ci: boolean;
  sarif: boolean;
  verbose: boolean;
  explain?: string;
  ai: boolean;
  cache: boolean;
  threshold: string;
  yes: boolean;
  color: boolean;
  framework?: string;
  ignore?: string;
}

const STAGE_NUMBER: Record<string, number> = {
  index: 1,
  ast: 2,
  deps: 3,
  git: 4,
  files: 5,
  exports: 6,
  env: 7,
  config: 8,
  ai: 9,
  done: 10,
};

function makeProgressLine(stderr: (t: string) => void): (stage: string, message?: string) => void {
  let previous: { stage: string; message?: string } | null = null;
  return (stage, message) => {
    if (stage === "done") {
      if (previous) {
        stderr(`  ✓ ${previous.message ?? previous.stage}`);
        previous = null;
      }
      return;
    }
    const num = STAGE_NUMBER[stage] ?? 99;
    if (previous && (STAGE_NUMBER[previous.stage] ?? 99) < num) {
      stderr(`  ✓ ${previous.message ?? previous.stage}`);
    }
    stderr(`  ▸ ${message ?? stage}...`);
    previous = { stage, message };
  };
}

function parseFlags(argv: string[]): CliFlags {
  const program = new Command();
  program
    .option("--fix")
    .option("-i, --interactive")
    .option("--json")
    .option("--ci")
    .option("--sarif")
    .option("--verbose")
    .option("--explain <item>")
    .option("--no-ai")
    .option("--no-cache")
    .option("--threshold <n>", "default 90")
    .option("--yes, -y")
    .option("--no-color")
    .option("--framework <name>")
    .option("--ignore <patterns>");
  program.exitOverride();
  program.parse(argv, { from: "user" });
  const o = program.opts() as Record<string, unknown>;
  return {
    fix: o["fix"] === true,
    interactive: o["interactive"] === true,
    json: o["json"] === true,
    ci: o["ci"] === true,
    sarif: o["sarif"] === true,
    verbose: o["verbose"] === true,
    explain: typeof o["explain"] === "string" ? (o["explain"] as string) : undefined,
    ai: o["ai"] !== false,
    cache: o["cache"] !== false,
    threshold: typeof o["threshold"] === "string" ? (o["threshold"] as string) : "90",
    yes: o["yes"] === true,
    color: o["color"] !== false,
    framework: typeof o["framework"] === "string" ? (o["framework"] as string) : undefined,
    ignore: typeof o["ignore"] === "string" ? (o["ignore"] as string) : undefined,
  };
}

function frameworkOf(value: string | undefined): "auto" | FrameworkName | undefined {
  if (!value) return undefined;
  const allowed = new Set([
    "auto",
    "javascript",
    "typescript",
    "node",
    "react",
    "next",
    "vite",
    "webpack",
    "angular",
    "vue",
    "express",
    "nestjs",
  ]);
  return allowed.has(value) ? (value as "auto" | FrameworkName) : undefined;
}

function thresholdOf(raw: string): number {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? Math.max(1, Math.min(99, n)) : 90;
}

async function confirm(prompt: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${prompt} [y/N] `, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });
}

export async function runCli(opts: RunCliOptions): Promise<number> {
  const flags = parseFlags(opts.argv);
  if (opts.tool === "init") {
    return runInit(flags);
  }

  const threshold = thresholdOf(flags.threshold);
  const root = process.cwd();
  const merged = mergeConfig(root, {
    ignore: flags.ignore?.split(",").map((s) => s.trim()).filter(Boolean),
    threshold,
    framework: frameworkOf(flags.framework),
    ai: flags.ai,
    enableCache: flags.cache,
    verbose: flags.verbose,
    noColor: !flags.color,
  });

  const logger = createLogger({ verbose: merged.verbose, noColor: !flags.color });

  if (merged.framework === "auto") {
    // resolved during analysis
  }

  const stderrProgress = makeProgressLine((t) => process.stderr.write(t + "\n"));
  const { result } = await runScan({
    root,
    framework: merged.framework,
    ignore: merged.ignore ?? (flags.ignore ? flags.ignore.split(",") : undefined),
    ai: merged.ai,
    enableCache: merged.enableCache,
    onProgress: (stage, message) => stderrProgress(stage, message),
  });

  // Request local AI setup when the user wanted AI but no provider exists.
  if (merged.ai && !result.ai.used && !(result.ai.refused ?? "").includes("disabled")) {
    process.stderr.write(ollamaSetupHint() + "\n");
  }

  // Focus the report on a single user-supplied path (nullcode src/auth.ts)
  const focusPath = opts.positional;
  if (focusPath) {
    const needle = focusPath.split("\\").join("/");
    const matched = result.candidates.filter((c) => {
      const relC = c.path ? c.path.split("\\").join("/") : "";
      return (
        relC.endsWith(needle) ||
        (c.packageName !== undefined && c.packageName === needle) ||
        c.name === needle
      );
    });
    if (matched.length === 0) {
      logger.raw(`No cleanup candidates found for '${focusPath}'.`);
      return 0;
    }
    result.candidates = matched;
  }

  // Tool filters
  if (opts.tool === "deps") {
    result.candidates = result.candidates.filter((c) => c.packageName !== undefined);
  } else if (opts.tool === "files") {
    result.candidates = result.candidates.filter((c) => c.path !== undefined && !c.packageName);
  } else if (opts.tool === "config") {
    result.candidates = result.candidates.filter((c) => c.type === "config_file");
  } else if (opts.tool === "env") {
    result.candidates = result.candidates.filter(
      (c) => c.type === "env_defined_unused" || c.type === "env_example_only",
    );
  }

  // Persist state (scan results + plan) so --fix/--interactive have a paper trail.
  await persistScanResult(root, result);

  if (flags.explain || opts.tool === "explain") {
    const item = flags.explain ?? opts.item;
    if (item) {
      const candidate = findCandidate(result.candidates, item);
      if (!candidate) {
        logger.warn(`No candidate matched '${item}'. Try a package name or a file path.`);
        return 1;
      }
      const explainLogger = createLogger({ verbose: merged.verbose, noColor: !flags.color });
      renderExplain(explainLogger, candidate, merged.verbose);
      return 0;
    }
  }

  if (flags.interactive) {
    const plan = buildCleanupPlan(result, root, { threshold, dryRun: true });
    await persistPlan(root, plan);
    await runInteractiveRemoval(result.candidates, {
      logger,
      onRemove: async (c: Candidate) => {
        const one = buildCleanupPlan(
          { ...result, candidates: [c] },
          root,
          { threshold: 1, dryRun: false },
        );
        const o = await applyPlan(root, one, (item, status, detail) => {
          if (status === "ok") logger.success(`${item.name}: ${detail}`);
          else if (status === "fail") logger.error(`${item.name}: ${detail}`);
        });
        if (o.removed.length === 0 && o.failed.length > 0) {
          logger.error(`Failed to remove ${c.name}.`);
        }
      },
    });
    return 0;
  }

  if (flags.fix || flags.ci) {
    const dryRun = !flags.fix;
    const plan = buildCleanupPlan(result, root, { threshold, dryRun });
    await persistPlan(root, plan);

    if (plan.items.length === 0) {
      logger.success(`No candidates meet the ${threshold}% threshold — nothing to fix.`);
      if (flags.ci) {
        process.stderr.write(renderCiReport(result, threshold) + "\n");
        return 0;
      }
      return 0;
    }

    logger.raw("");
    logger.banner("Cleanup plan:");
    logger.raw("");
    for (const item of plan.items) {
      logger.raw(`  REMOVE  ${item.name}  (${item.kind}, ${item.confidence}%)`);
    }
    if (plan.skipped.length > 0) {
      logger.raw("");
      logger.raw(`  SKIP (below ${threshold}%):`);
      for (const item of plan.skipped.slice(0, 10)) {
        logger.raw(`    ${item.name}  (${item.confidence}%)`);
      }
      if (plan.skipped.length > 10) logger.raw(`    … and ${plan.skipped.length - 10} more`);
    }
    logger.raw("");

    if (dryRun) {
      logger.raw("  This was a dry run. Re-run with --fix to apply.");
      logger.raw(`  Backup location: ${path.join(stateDir(root), "backup")}`);
      logger.raw("");
      if (flags.ci) {
        process.stderr.write(renderCiReport(result, threshold) + "\n");
        return evaluateCi(result, threshold).failed ? 1 : 0;
      }
      return 0;
    }

    if (!flags.yes) {
      const ok = await confirm(`Apply ${plan.items.length} change(s)?`);
      if (!ok) {
        logger.raw("Aborted — nothing was changed.");
        return 0;
      }
    }

    const outcome = await applyPlan(root, plan, (item, status, detail) => {
      if (status === "ok") logger.success(`${item.name}: ${detail}`);
      else if (status === "fail") logger.error(`${item.name}: ${detail}`);
      else logger.info(`${item.name}: ${detail}`);
    });

    logger.raw("");
    logger.banner("CLEANUP COMPLETE");
    logger.raw("");
    logger.success(`${outcome.removed.length} item(s) removed.`);
    if (outcome.failed.length > 0) {
      logger.error(`${outcome.failed.length} item(s) failed:`);
      for (const f of outcome.failed) logger.raw(`  - ${f.name}`);
    }
    logger.raw(`Backup saved at: ${outcome.backupPath}`);
    logger.raw("");
    if (outcome.modifiedPackageJson.length > 0) {
      logger.raw("  package.json was edited. Run `npm install` to sync the lockfile.");
    }
    logger.raw("  Restore: `npx nullcode restore <backup-path>`");
    return 0;
  }

  // ----- default report mode -----
  if (flags.json) {
    process.stdout.write(renderJsonReport(result) + "\n");
    return 0;
  }
  if (flags.sarif) {
    process.stdout.write(JSON.stringify(renderSarifReport(result, root), null, 2) + "\n");
    return 0;
  }
  if (flags.ci) {
    process.stderr.write(renderCiReport(result, threshold) + "\n");
    return evaluateCi(result, threshold).failed ? 1 : 0;
  }

  renderTerminalReport(result, { verbose: merged.verbose });
  return 0;
}

function findCandidate(
  candidates: Candidate[],
  item: string,
): Candidate | undefined {
  const needle = item.split("\\").join("/");
  return (
    candidates.find((c) => c.name === needle || c.packageName === needle) ??
    candidates.find((c) => c.name.includes(needle)) ??
    candidates.find((c) => (c.path ? c.path.replace(/\\/g, "/").endsWith(needle) : false))
  );
}

async function runInit(flags: CliFlags): Promise<number> {
  const root = process.cwd();
  const logger = createLogger({ noColor: !flags.color });
  const target = path.join(root, ".nullcodeignore");
  if (fs.existsSync(target)) {
    logger.warn(`${target} already exists — leaving it untouched.`);
    return 0;
  }
  const template = `# .nullcodeignore — patterns never scanned by nullcode
# Syntax follows .gitignore conventions.

generated/
vendor/
legacy/
src/generated/**
dist/
coverage/
`;
  await fs.promises.writeFile(target, template, "utf8");
  logger.success(`Created ${target}`);
  return 0;
}