import type { AnalyzerContext } from "../analyzer/index.js";
import type { Candidate, DeepSeekEvidencePayload } from "../types/index.js";
import { redactSecrets } from "../utils/redact.js";
import { resolveProvider, type LLMProvider } from "./llm.js";
import { ollamaSetupHint } from "./ollama.js";

const BATCH_SIZE = 20;

const SYSTEM_PROMPT = `You are a conservative senior code-maintenance reviewer embedded in a static analysis tool.

For each candidate you are given STRUCTURED EVIDENCE produced by a deterministic
static-analysis engine (AST import graph, bundler config scanning, git history,
framework conventions, string references). Your job is NOT to decide "unused"
from the evidence alone. Your job is to reason about ways the candidate could
STILL be used, because false positives are the worst outcome.

Reason through each of these questions:
1. Could the item be genuinely unused?
2. Could it be accessed dynamically (import() with a variable, glob, require.context)?
3. Could a framework discover it automatically (file conventions, route maps)?
4. Could it be a build or configuration entry point referenced by name?
5. Could it be required only in production (conditional requires, platform branches)?
6. Could it be used by npm scripts or shell scripts not captured here?
7. Could it be referenced through strings (glob patterns, stringified paths)?
8. Could it be used by external consumers (library exports, peerDependencies)?
9. Could removing it break CI/CD (deployment configs, test runners)?
10. What single piece of evidence most supports the "safe to remove" conclusion?

Rules:
- Return JSON only: {"assessments":[{"key":"<candidate key>","adjustment":<int -25..9>,"reasoning":"<1-3 sentences>","verdict":"SAFE|RISKY|UNCERTAIN"}]}
- adjustment is added to the static confidence. Use NEGATIVE adjustments when you identify a plausible usage path the static engine could not see (down to -25). Use positive adjustments (max +9) ONLY when the evidence is exhaustive and you find no risk path.
- When in doubt, prefer a negative or zero adjustment.
- Do not invent evidence. Base every statement on the provided fields.
- Never mention secrets; none are provided.`;

export interface AiOptimizationResult {
  used: boolean;
  provider?: string;
  model?: string;
  errors: string[];
}

function buildEvidence(
  ctx: AnalyzerContext,
  c: Candidate,
): DeepSeekEvidencePayload {
  return {
    candidate: c.name,
    type: c.type,
    references: {
      imports: c.evidence.imports,
      requires: c.evidence.requires,
      dynamic_imports: c.evidence.dynamicImports,
      scripts: c.evidence.scripts.length,
      configs: c.evidence.configs.length,
      string_refs: c.evidence.stringRefs,
      tests: c.evidence.testRefs,
    },
    imports: c.evidence.importFiles.slice(0, 15),
    imported_by: (c.path ? c.evidence.referencedBy ?? [] : []).slice(0, 15),
    exports: (c.evidence.exported ?? []).slice(0, 20),
    string_references: [],
    package_references: c.evidence.importFiles.slice(0, 15),
    git: {
      last_commit: c.evidence.git?.lastCommit ?? "n/a",
      commit_count: c.evidence.git?.commitCount ?? 0,
      months_since_change: c.evidence.git?.monthsSinceLastChange ?? "n/a",
      removed_from_history: c.evidence.git?.removedFromHistory ?? false,
    },
    framework: c.evidence.framework,
    dynamic_import_risk: c.evidence.dynamicRisk,
    dead_only: c.evidence.deadOnly,
    pending: c.evidence.pending,
  };
}

interface Assessment {
  key?: string;
  adjustment?: number;
  reasoning?: string;
  verdict?: string;
}

export async function aiOptimizeCandidates(
  ctx: AnalyzerContext,
  candidates: Candidate[],
  opts: { enabled: boolean },
): Promise<AiOptimizationResult> {
  if (!opts.enabled || candidates.length === 0) {
    return { used: false, errors: [] };
  }
  const provider: LLMProvider | null = resolveProvider();
  if (!provider) {
    return { used: false, errors: ["No LLM provider configured.\n" + ollamaSetupHint()] };
  }

  const errors: string[] = [];
  const batches: Candidate[][] = [];
  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    batches.push(candidates.slice(i, i + BATCH_SIZE));
  }

  for (const batch of batches) {
    const evidence = batch.map((c) => buildEvidence(ctx, c));
    const payloadJson = JSON.stringify({
      framework: ctx.framework,
      candidates: evidence,
    });
    const safePayload = redactSecrets(payloadJson);
    try {
      const raw = await provider.complete(SYSTEM_PROMPT, safePayload, true);
      const parsed = parseAssessments(raw);
      for (const a of parsed) {
        const candidate = batch.find((c) => c.key === a.key);
        if (!candidate || typeof a.adjustment !== "number") continue;
        candidate.ai = {
          used: true,
          provider: provider.name,
          model: provider.model,
          adjustment: a.adjustment,
          reasoning: redactSecrets(a.reasoning ?? "").slice(0, 500),
          verdict: a.verdict,
        };
      }
    } catch (err) {
      errors.push(`Batch failed: ${(err as Error).message}`);
    }
  }

  const anyUsed = candidates.some((c) => c.ai?.used === true);
  return {
    used: anyUsed,
    provider: provider.name,
    model: provider.model,
    errors,
  };
}

function parseAssessments(raw: string): Assessment[] {
  try {
    const data = JSON.parse(raw) as { assessments?: Assessment[] };
    if (Array.isArray(data.assessments)) {
      return data.assessments.filter((a) => typeof a?.key === "string");
    }
  } catch {
    // fall through to lenient parse
  }
  const m = /"key"\s*:\s*"([^"]+)"\s*,\s*"adjustment"\s*:\s*(-?\d+)/g;
  const out: Assessment[] = [];
  let match: RegExpExecArray | null;
  while ((match = m.exec(raw)) !== null) {
    out.push({ key: match[1]!, adjustment: parseInt(match[2]!, 10) });
  }
  return out;
}

export function applyAiAdjustment(candidate: Candidate): void {
  const adj = candidate.ai?.adjustment ?? 0;
  if (adj === 0) return;
  const clamped = Math.max(-25, Math.min(9, adj));
  const total =
    candidate.scoreParts.reduce((sum, p) => sum + p.points, 0) + clamped;
  candidate.confidence = Math.max(1, Math.min(99, Math.round(total)));
  candidate.scoreParts.push({ label: "AI assessment", points: clamped });
}