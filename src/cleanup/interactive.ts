import type { Candidate } from "../types/index.js";
import { createLogger, type Logger } from "../utils/logger.js";

export { createLogger };

export interface InteractiveDecision {
  action: "remove" | "skip";
  candidate: Candidate;
}

function keypress(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    process.stdout.write(prompt);
    process.stdin.setRawMode?.(true);
    process.stdin.resume();
    const onData = (chunk: Buffer): void => {
      const key = chunk.toString().trim().toLowerCase();
      cleanup();
      process.stdout.write("\n");
      resolve(key);
    };
    const onError = (err: Error): void => {
      cleanup();
      reject(err);
    };
    const cleanup = (): void => {
      process.stdin.setRawMode?.(false);
      process.stdin.pause();
      process.stdin.removeListener("data", onData);
      process.stdin.removeListener("error", onError);
    };
    process.stdin.once("data", onData);
    process.stdin.once("error", onError);
    setTimeout(() => {
      cleanup();
      reject(new Error("interactive timeout"));
    }, 120_000);
  });
}

export async function runInteractiveRemoval(
  candidates: Candidate[],
  opts: { logger: Logger; onRemove: (c: Candidate) => Promise<void> },
): Promise<void> {
  const { logger } = opts;
  const sorted = [...candidates].sort((a, b) => b.confidence - a.confidence);
  let idx = 0;
  let removedCount = 0;

  logger.raw("");
  logger.banner("Interactive cleanup — [r] remove [s] skip [e] explain [v] view refs [q] quit");

  while (idx < sorted.length) {
    const c = sorted[idx]!;
    logger.raw("");
    logger.raw("─".repeat(58));
    logger.raw(`Candidate ${idx + 1} of ${sorted.length}`);
    logger.raw("");
    logger.raw(`  ${c.name}`);
    logger.raw("");
    logger.raw(`  Confidence: ${c.confidence}%  (${c.category})`);
    logger.raw("");
    logger.raw("  Evidence:");
    logger.raw(`  • ${c.evidence.imports} imports / ${c.evidence.requires} require() / ${c.evidence.dynamicImports} dynamic`);
    logger.raw(`  • ${c.evidence.scripts.length} script references / ${c.evidence.configs.length} config references`);
    if (c.evidence.stringRefs > 0) {
      logger.raw(`  • ${c.evidence.stringRefs} string references`);
    }
    logger.raw("");

    const key = await keypress("  [r] Remove  [s] Skip  [e] Explain  [v] View refs  [q] Quit → ");

    if (key === "q") {
      logger.raw("Quit. Nothing further was changed.");
      break;
    }
    if (key === "r") {
      await opts.onRemove(c);
      removedCount++;
      idx++;
      continue;
    }
    if (key === "s") {
      idx++;
      continue;
    }
    if (key === "e") {
      logger.raw("");
      logger.raw(`  Recommendation: ${c.recommendation}`);
      logger.raw(`  Score breakdown:`);
      for (const part of c.scoreParts) {
        const sign = part.points > 0 ? "+" : "";
        logger.raw(`    ${sign}${part.points}  ${part.label}`);
      }
      if (c.ai?.reasoning) {
        logger.raw(`  AI reasoning: ${c.ai.reasoning}`);
      }
      logger.raw("");
      continue;
    }
    if (key === "v") {
      logger.raw("");
      logger.raw(`  Reference details for ${c.name}:`);
      logger.raw(`    files importing: ${c.evidence.importFiles.length}`);
      logger.raw(`    scripts: ${c.evidence.scripts.length > 0 ? c.evidence.scripts.join(", ") : "none"}`);
      logger.raw(`    configs: ${c.evidence.configs.length > 0 ? c.evidence.configs.join(", ") : "none"}`);
      logger.raw("");
      continue;
    }
    logger.warn(`Unknown key '${key}'`);
  }

  logger.raw("");
  logger.success(`Interactive session finished. Removed ${removedCount} candidate(s).`);
}