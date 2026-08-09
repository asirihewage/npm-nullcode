import type { Candidate, ConfidenceCategory, ScanResult } from "../types/index.js";
import { createLogger, type Logger } from "../utils/logger.js";
import { CATEGORY_DESCRIPTIONS } from "../scoring/scorer.js";
import { formatLines, formatNumber, monthsSince } from "../utils/format.js";
import { truncateList } from "../utils/format.js";

const CATEGORY_LABEL: Record<ConfidenceCategory, string> = {
  SAFE_TO_REMOVE: "HIGH CONFIDENCE",
  LIKELY_UNUSED: "LIKELY UNUSED",
  REVIEW_REQUIRED: "REVIEW REQUIRED",
  PROBABLY_USED: "POSSIBLY USED",
  USED: "USED",
};

const CATEGORY_ICON: Record<ConfidenceCategory, string> = {
  SAFE_TO_REMOVE: "🔴",
  LIKELY_UNUSED: "🟠",
  REVIEW_REQUIRED: "🟡",
  PROBABLY_USED: "🟢",
  USED: "⚪",
};

function categoryName(c: Candidate): string {
  return `${CATEGORY_ICON[c.category]} ${CATEGORY_LABEL[c.category]}`;
}

export function renderTerminalReport(result: ScanResult, opts: { verbose?: boolean }): void {
  const logger = createLogger({ verbose: opts.verbose });
  const { candidates, stats } = result;

  logger.banner("🧹 nullcode");
  logger.raw("");
  logger.info(`Scanned: ${result.rootDir}`);
  logger.success(`${formatNumber(stats.files)} files analyzed`);
  if (stats.dependencies > 0) logger.success(`${formatNumber(stats.dependencies)} dependencies analyzed`);
  if (stats.imports > 0) logger.success(`${formatNumber(stats.imports)} imports analyzed`);
  if (stats.configReferences > 0) logger.success(`${formatNumber(stats.configReferences)} configuration references analyzed`);
  if (stats.git) logger.success("Git history analyzed");
  else logger.info("Git history not available");
  logger.raw("");

  if (result.ai.used) {
    logger.info(`AI verification: ${result.ai.provider} (${result.ai.model})`);
  } else {
    logger.info(`AI verification: not applied (${result.ai.refused ?? "deterministic mode"})`);
  }
  logger.raw("");

  if (candidates.length === 0) {
    logger.success("No cleanup candidates found. Your project looks tidy.");
    logger.raw("");
    return;
  }

  const byCategory = new Map<ConfidenceCategory, Candidate[]>();
  for (const c of candidates) {
    const list = byCategory.get(c.category) ?? [];
    list.push(c);
    byCategory.set(c.category, list);
  }

  const order: ConfidenceCategory[] = [
    "SAFE_TO_REMOVE",
    "LIKELY_UNUSED",
    "REVIEW_REQUIRED",
    "PROBABLY_USED",
    "USED",
  ];

  for (const cat of order) {
    const list = byCategory.get(cat) ?? [];
    if (list.length === 0) continue;
    logger.banner(categoryName(list[0]!));
    logger.raw("");
    for (const c of list) {
      renderCandidate(logger, c, opts.verbose ?? false);
      logger.raw("");
    }
  }

  if (result.duplicates.length > 0) {
    logger.banner("⚠ DUPLICATES / MULTIPLE VERSIONS");
    logger.raw("");
    for (const d of result.duplicates) {
      logger.raw(`  ${d.package} — ${d.detail}`);
    }
    logger.raw("");
  }

  for (const info of result.infoMessages) {
    logger.info(info);
  }
  for (const warn of result.warnings) {
    logger.warn(warn);
  }

  renderSummary(logger, result);
}

function renderCandidate(logger: Logger, c: Candidate, verbose: boolean): void {
  logger.raw(`  ${c.name}`);
  if (c.version && c.packageName) {
    logger.raw(`    ${c.packageName}@${c.version}`);
  }
  if (c.path) {
    const rel = c.path.split("\\").join("/").replace(/^.*?(?=\/)/, "");
    logger.raw(`    ${rel}`);
  }
  logger.raw("");
  const evidence = c.evidence;
  logger.raw(`    Evidence:`);
  logger.raw(`      • ${evidence.imports} imports`);
  logger.raw(`      • ${evidence.requires} require() references`);
  logger.raw(`      • ${evidence.dynamicImports} dynamic import references`);
  logger.raw(`      • ${evidence.scripts.length} script references`);
  logger.raw(`      • ${evidence.configs.length} config references`);
  if (evidence.stringRefs > 0) {
    logger.raw(`      • ${evidence.stringRefs} string references`);
  }
  if (evidence.deadOnly) {
    logger.raw(`      • only used by dead code`);
  }
  if (evidence.git?.monthsSinceLastChange != null) {
    logger.raw(`      • last changed ${monthsSince(evidence.git.lastCommit) !== null ? `~${formatNumber(monthsSince(evidence.git.lastCommit)!)} months ago` : "long ago"} (git)`);
  } else if (evidence.git?.available === false || !evidence.git) {
    logger.raw(`      • git history unavailable`);
  }
  logger.raw("");
  logger.raw(`    Confidence: ${c.confidence}%`);
  logger.raw("");
  logger.raw(`    ${c.recommendation}`);
  if (c.action?.kind === "uninstall") {
    logger.raw(`    Suggested: npm uninstall ${c.packageName}`);
  }
  if (verbose) {
    logger.raw(`    Score:`);
    for (const part of c.scoreParts) {
      const sign = part.points > 0 ? "+" : "";
      logger.raw(`      ${sign}${part.points}  ${part.label}`);
    }
    if (c.ai?.reasoning) {
      logger.raw(`    AI: ${c.ai.reasoning}`);
    }
  }
}

export function renderTerminalSummary(logger: Logger, result: ScanResult): void {
  renderSummary(logger, result);
}

function renderSummary(logger: Logger, result: ScanResult): void {
  const candidates = result.candidates;
  const line = "─".repeat(60);
  logger.raw("");
  logger.raw(line);
  logger.banner("CLEANUP SUMMARY");
  logger.raw("");

  const count = (cat: ConfidenceCategory): number =>
    candidates.filter((c) => c.category === cat).length;
  logger.raw(`  🔴 ${count("SAFE_TO_REMOVE")} high-confidence candidates`);
  logger.raw(`  🟠 ${count("LIKELY_UNUSED")} likely-unused candidates`);
  logger.raw(`  🟡 ${count("REVIEW_REQUIRED")} candidates requiring review`);
  logger.raw(`  🟢 ${count("PROBABLY_USED")} low-confidence candidates`);
  logger.raw("");

  const files = candidates.filter((c) => c.path);
  const deps = candidates.filter((c) => c.packageName);
  const totalLines = files.reduce((sum, c) => sum + (c.evidence.lines ?? 0), 0);
  logger.raw(`  Potentially removable:`);
  logger.raw(`    ${files.length} files`);
  logger.raw(`    ${deps.length} dependencies`);
  logger.raw(`    ${formatLines(totalLines)} estimated`);
  logger.raw("");
  logger.raw("  Run:");
  logger.raw(`    nullcode --interactive   # review and remove file-by-file`);
  logger.raw(`    nullcode --fix --yes     # remove only ≥90% confidence items`);
  logger.raw("");
  logger.raw(line);
}

export function renderExplain(logger: Logger, c: Candidate, verbose: boolean): void {
  logger.banner("WHY THIS WAS FLAGGED");
  logger.raw("");
  logger.raw(`  Item: ${c.name}`);
  if (c.packageName && c.version) logger.raw(`  Package: ${c.packageName}@${c.version}`);
  if (c.path) logger.raw(`  File: ${c.path}`);
  logger.raw(`  Category: ${c.category} (confidence ${c.confidence}%)`);
  logger.raw("");
  logger.raw("  References:");
  logger.raw(`    imports:        ${c.evidence.imports}`);
  logger.raw(`    require():      ${c.evidence.requires}`);
  logger.raw(`    dynamic import: ${c.evidence.dynamicImports}`);
  logger.raw(`    scripts:        ${c.evidence.scripts.length}`);
  logger.raw(`    config files:   ${c.evidence.configs.length}`);
  if (c.evidence.stringRefs > 0) logger.raw(`    string refs:    ${c.evidence.stringRefs}`);
  logger.raw("");
  logger.raw("  Dependency graph:");
  const importers = c.evidence.importFiles;
  logger.raw(`    ${importers.length === 0 ? "No active dependency path found." : importers.slice(0, 8).join(", ")}`);
  logger.raw("");
  logger.raw("  Git:");
  if (c.evidence.git?.lastCommit) {
    logger.raw(`    Last modification: ${c.evidence.git.lastCommit.slice(0, 10)}`);
  } else if (c.evidence.git?.available) {
    logger.raw("    Not tracked in git history (new or untracked file).");
  } else {
    logger.raw("    Git history not available.");
  }
  logger.raw("");
  logger.raw("  Scoring:");
  for (const part of c.scoreParts) {
    const sign = part.points > 0 ? "+" : "";
    logger.raw(`    ${sign}${part.points}  ${part.label}`);
  }
  if (c.ai?.reasoning) {
    logger.raw("");
    logger.raw("  AI assessment:");
    logger.raw(`    ${c.ai.reasoning}`);
  }
  logger.raw("");
  logger.raw(`  Confidence: ${c.confidence}%`);
  logger.raw(`  Recommendation: ${c.recommendation}`);
  if (verbose) {
    logger.raw("");
    logger.raw("  Risk note:");
    logger.raw(`    ${CATEGORY_DESCRIPTIONS[c.category]}`);
    logger.raw(`    Dynamic import risk: ${c.evidence.dynamicRisk}`);
  }
}

export function truncateListForReport(items: string[], max: number): string[] {
  return truncateList(items, max);
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}