import type { ScanResult } from "../types/index.js";

export interface CiOutcome {
  failed: boolean;
  count: number;
  threshold: number;
}

export function evaluateCi(result: ScanResult, threshold: number): CiOutcome {
  const over = result.candidates.filter((c) => c.confidence >= threshold);
  return {
    failed: over.length > 0,
    count: over.length,
    threshold,
  };
}

export function renderCiReport(result: ScanResult, threshold: number): string {
  const outcome = evaluateCi(result, threshold);
  const lines: string[] = [];
  if (outcome.failed) {
    lines.push("Cleanup check FAILED.");
    lines.push("");
    lines.push(`${outcome.count} candidate${outcome.count === 1 ? "" : "s"} above the ${threshold}% threshold.`);
    lines.push("");
    const top = result.candidates
      .filter((c) => c.confidence >= threshold)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 15);
    top.forEach((c, i) => {
      lines.push(`${i + 1}. ${c.name}`);
      lines.push(`   confidence: ${c.confidence}%`);
      lines.push(`   category: ${c.category}`);
    });
    lines.push("");
    lines.push("Run `nullcode --interactive` to review, or raise the threshold with --threshold.");
    lines.push("");
    lines.push("Exit code: 1");
  } else {
    lines.push("Cleanup check PASSED.");
    lines.push(`No candidates found above the ${threshold}% threshold.`);
    lines.push("");
    lines.push("Exit code: 0");
  }
  return lines.join("\n");
}