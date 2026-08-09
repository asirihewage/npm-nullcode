import type { ConfidenceCategory, ScorePart } from "../types/index.js";
import { clamp } from "../utils/format.js";

export interface ScoringInput {
  /** positive evidence names already scored */
  positives: ScorePart[];
  /** negative evidence (risk factors) */
  negatives: ScorePart[];
  /** AI adjustment in [-25, +9]. Positive boosts are deliberately capped
   * tighter than negative penalties: AI may raise trust a little, but its
   * strongest signal is finding usage paths the static engine missed. */
  aiAdjustment?: number;
}

/**
 * The confidence score represents "how confident we are that removing this
 * item is safe". It is derived from additive positive evidence, then reduced
 * by every negative risk factor that applies. It is never 100 — there is no
 * such thing as "definitely unused".
 */
export function scoreConfidence(input: ScoringInput): {
  confidence: number;
  parts: ScorePart[];
} {
  const positives = [...input.positives];
  const negatives = [...input.negatives];

  let total = 0;
  const parts = [...positives.map((p) => ({ label: p.label, points: p.points }))];

  for (const p of positives) total += p.points;
  for (const n of negatives) total += n.points; // negatives carry negative points

  parts.push(...negatives.map((n) => ({ label: n.label, points: n.points })));

  if (input.aiAdjustment !== undefined && input.aiAdjustment !== 0) {
    const clamped = clamp(input.aiAdjustment, -25, 9);
    total += clamped;
    parts.push({ label: "AI assessment", points: clamped });
  }

  const confidence = clamp(Math.round(total), 1, 99);
  return { confidence, parts };
}

export function categoryFor(confidence: number): ConfidenceCategory {
  if (confidence >= 90) return "SAFE_TO_REMOVE";
  if (confidence >= 75) return "LIKELY_UNUSED";
  if (confidence >= 60) return "REVIEW_REQUIRED";
  if (confidence >= 40) return "PROBABLY_USED";
  return "USED";
}

export const CATEGORY_DESCRIPTIONS: Record<ConfidenceCategory, string> = {
  SAFE_TO_REMOVE: "High confidence — no usage detected across all known reference paths.",
  LIKELY_UNUSED: "Likely safe — strong evidence, but a manual glance is advised.",
  REVIEW_REQUIRED: "Review required — some evidence of usage or dynamic access.",
  PROBABLY_USED: "Possibly used — treat as in use unless you can verify otherwise.",
  USED: "In use — keep.",
};

export const CATEGORY_MIN: Record<ConfidenceCategory, number> = {
  SAFE_TO_REMOVE: 90,
  LIKELY_UNUSED: 75,
  REVIEW_REQUIRED: 60,
  PROBABLY_USED: 40,
  USED: 0,
};