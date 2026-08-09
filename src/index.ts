import type { FrameworkName } from "./types/index.js";
import { analyzeProject } from "./analyzer/index.js";
import { detectCandidates, type DetectResult } from "./candidates/index.js";
import { aiOptimizeCandidates, applyAiAdjustment } from "./ai/reasoning.js";
import { describeProvider } from "./ai/llm.js";
import { formatNumber } from "./utils/format.js";
import type { ScanResult } from "./types/index.js";

export interface RunScanOptions {
  root?: string;
  framework?: "auto" | FrameworkName;
  ignore?: string[];
  ai?: boolean;
  enableCache?: boolean;
  onProgress?: (stage: string, message?: string) => void;
}

export interface RunScanResult {
  result: ScanResult;
  detect: DetectResult;
}

const TOOL_VERSION = "0.1.0";

/**
 * The programmatic entry point: analyze a repository, detect candidates and
 * (optionally) run the AI reasoning layer over them.
 */
export async function runScan(opts: RunScanOptions = {}): Promise<RunScanResult> {
  const root = opts.root ?? process.cwd();

  const ctx = await analyzeProject({
    root,
    ignore: opts.ignore,
    framework: opts.framework,
    enableCache: opts.enableCache,
    onProgress: opts.onProgress,
  });

  const detect = await detectCandidates(ctx, {
    onProgress: opts.onProgress,
  });

  const provider = describeProvider();
  const aiEnabled = opts.ai !== false && provider.configured;
  let ai: ScanResult["ai"] = {
    used: false,
    refused: aiEnabled
      ? undefined
      : opts.ai === false
        ? "disabled via --no-ai"
        : "no LLM provider configured (set DEEPSEEK_API_KEY, OPENAI_API_KEY or NPM_CLEANUP_LLM=ollama)",
  };

  if (aiEnabled) {
    opts.onProgress?.("ai", "Running AI verification...");
    const aiResult = await aiOptimizeCandidates(ctx, detect.candidates, { enabled: true });
    if (aiResult.used) {
      let applied = 0;
      for (const c of detect.candidates) {
        if (c.ai?.used) {
          applyAiAdjustment(c);
          applied++;
          c.category = scoreCategory(c.confidence);
          c.recommendation = aiRecommendation(c);
        }
      }
      ai = { used: true, provider: aiResult.provider, model: aiResult.model };
      opts.onProgress?.("ai", `${applied} candidates verified by ${aiResult.provider}`);
      if (aiResult.errors.length > 0) {
        detect.warnings.push(`AI verification had errors: ${aiResult.errors.join("; ")}`);
      }
    } else {
      ai = {
        used: false,
        refused: aiResult.errors[0] ?? "LLM request failed — falling back to deterministic scoring",
      };
    }
  }

  for (const c of detect.candidates) {
    if (!c.ai?.used) {
      c.ai = { used: false };
    }
  }

  const sourceFiles = ctx.files.filter(
    (f) => f.kind === "source" || f.kind === "test",
  ).length;
  const totalImports = [...ctx.ast.values()].reduce(
    (sum, s) => sum + s.imports.length + s.reexports.length,
    0,
  );

  const result: ScanResult = {
    tool: "npm-cleanup",
    version: TOOL_VERSION,
    rootDir: root,
    framework: ctx.framework,
    ai,
    stats: {
      files: ctx.files.length,
      sourceFiles,
      dependencies: ctx.pkgNames.size,
      imports: totalImports,
      configReferences: ctx.configFiles.length,
      git: ctx.git.available,
    },
    candidates: detect.candidates,
    duplicates: detect.duplicates,
    warnings: detect.warnings,
    infoMessages: detect.infoMessages,
  };

  opts.onProgress?.("done", `Scan complete — ${formatNumber(detect.candidates.length)} candidate(s)`);
  return { result, detect };
}

export function scoreCategory(confidence: number): ScanResult["candidates"][number]["category"] {
  if (confidence >= 90) return "SAFE_TO_REMOVE";
  if (confidence >= 75) return "LIKELY_UNUSED";
  if (confidence >= 60) return "REVIEW_REQUIRED";
  if (confidence >= 40) return "PROBABLY_USED";
  return "USED";
}

function aiRecommendation(c: ScanResult["candidates"][number]): string {
  if (c.ai?.verdict === "RISKY") {
    return "AI review flagged potential usage paths — do not remove without manual verification.";
  }
  if (c.ai?.reasoning) {
    return `${c.recommendation} AI: ${c.ai.reasoning}`;
  }
  return c.recommendation;
}

export { analyzeProject, detectCandidates } from "./index-exports.js";
export * from "./types/index.js";
export const VERSION = TOOL_VERSION;