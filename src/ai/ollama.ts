import * as cp from "node:child_process";

/**
 * Local AI via Ollama. nullcode prefers to use a locally installed Ollama
 * (with a coding-oriented model such as qwen2.5-coder); when Ollama is not
 * available it emits a setup request instead of silently skipping AI.
 */

/** Coding-focused models we prefer, in order. */
export const CODING_MODEL_PREFERENCE = [
  "qwen2.5-coder",
  "qwen3-coder",
  "qwen-coder",
  "deepseek-coder",
  "codellama",
  "codegemma",
  "granite-code",
  "starcoder2",
  "qwen3",
  "qwen2.5",
  "llama3.3",
  "llama3.2",
  "llama3.1",
  "deepseek-r1",
];

/** Pick the best coding model from an `ollama list` output set. */
export function pickCodingModel(models: readonly string[]): string | null {
  if (models.length === 0) return null;
  for (const preferred of CODING_MODEL_PREFERENCE) {
    for (const m of models) {
      const base = m.split(":")[0]!;
      if (base === preferred || base.startsWith(preferred + "-")) return m;
    }
  }
  // Fallback: anything explicitly a "coder" model.
  const coder = models.find((m) => /coder/i.test(m));
  if (coder) return coder;
  return models[0]!;
}

/** Parse `ollama list` table output into model names. */
export function parseOllamaList(output: string): string[] {
  const lines = output
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const esc = String.fromCharCode(27);
    const ansiRe = new RegExp(`^${esc}\\[[0-9;]*m`, "g");
    const isHeader = i === 0 && /^NAME\s+ID\s+SIZE\s+MODIFIED/i.test(line.replace(ansiRe, ""));
    if (isHeader) continue;
    const first = line.split(/\s{2,}/)[0]!;
    if (first.length > 0 && !first.includes(esc + "[") && !/^NAME/.test(first)) {
      out.push(first.trim());
    }
  }
  return out;
}

export interface OllamaDetection {
  installed: boolean;
  models: string[];
  model: string | null;
  error?: string;
}

/** Detect a local Ollama install and a usable coding model (sync, fast). */
export function detectOllama(timeoutMs = 4000): OllamaDetection {
  let installed = false;
  let models: string[] = [];
  let error: string | undefined;
  try {
    const res = cp.spawnSync("ollama", ["list"], {
      encoding: "utf8",
      timeout: timeoutMs,
      windowsHide: true,
    });
    if (res.status === 0) {
      installed = true;
      models = parseOllamaList(res.stdout ?? "");
      if (res.stderr && res.stderr.trim().length > 0) {
        error = res.stderr.trim().slice(0, 200);
      }
    } else if (res.error) {
      error = res.error.message;
    } else {
      error = (res.stderr ?? "").trim().slice(0, 200) || `ollama list exited ${res.status}`;
    }
  } catch (err) {
    error = (err as Error).message;
  }
  return { installed, models, model: installed ? pickCodingModel(models) : null, error };
}

/** Human instruction shown when no local LLM is available. */
export function ollamaSetupHint(): string {
  return [
    "Local AI (Ollama) is not available. To enable AI-assisted cleanup:",
    "  1. Install Ollama: https://ollama.com/download",
    "  2. Pull a coding model:  ollama pull qwen2.5-coder:7b",
    "     (any coding model works: qwen2.5-coder:14b, deepseek-coder-v2, codellama, ...)",
    "  3. Re-run nullcode and the local model verifies every candidate.",
    "Alternative: export DEEPSEEK_API_KEY or OPENAI_API_KEY for a hosted provider.",
  ].join("\n");
}