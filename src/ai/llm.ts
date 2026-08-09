import { detectOllama } from "./ollama.js";

export interface LLMProvider {
  name: string;
  model: string;
  complete(system: string, user: string, jsonMode: boolean): Promise<string>;
}

export interface ProviderConfig {
  name: string;
  model: string;
}

const DEFAULT_TIMEOUT_MS = 60_000;

async function postJson(
  url: string,
  body: unknown,
  headers: Record<string, string>,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`LLM API ${res.status}: ${text.slice(0, 300)}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

interface StreamChoice {
  message?: { content?: string };
  text?: string;
  response?: string;
}

function extractText(data: unknown): string {
  const d = data as {
    choices?: StreamChoice[];
    response?: string;
    content?: string;
    message?: { content?: string };
  };
  const choice = d.choices?.[0];
  const content =
    choice?.message?.content ?? choice?.text ?? d.response ?? d.content ?? d.message?.content;
  if (typeof content === "string") return content;
  return JSON.stringify(d);
}

export function resolveProvider(): LLMProvider | null {
  const deepseekKey = process.env["DEEPSEEK_API_KEY"];
  if (deepseekKey && deepseekKey.trim().length > 0) {
    const base = process.env["DEEPSEEK_BASE_URL"] ?? "https://api.deepseek.com";
    const model = process.env["NULLCODE_MODEL"] ?? "deepseek-chat";
    return {
      name: "deepseek",
      model,
      async complete(system, user, jsonMode) {
        const data = await postJson(
          `${base.replace(/\/$/, "")}/chat/completions`,
          {
            model,
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
            temperature: 0,
            ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
          },
          { authorization: `Bearer ${deepseekKey.trim()}` },
        );
        return extractText(data);
      },
    };
  }

  const openaiKey = process.env["OPENAI_API_KEY"];
  if (openaiKey && openaiKey.trim().length > 0) {
    const base = process.env["OPENAI_BASE_URL"] ?? "https://api.openai.com/v1";
    const model = process.env["NULLCODE_MODEL"] ?? "gpt-4o-mini";
    return {
      name: "openai",
      model,
      async complete(system, user, jsonMode) {
        const data = await postJson(
          `${base.replace(/\/$/, "")}/chat/completions`,
          {
            model,
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
            temperature: 0,
            ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
          },
          { authorization: `Bearer ${openaiKey.trim()}` },
        );
        return extractText(data);
      },
    };
  }

  if (process.env["NULLCODE_LLM"] === "ollama") {
    const base = process.env["OLLAMA_URL"] ?? "http://localhost:11434";
    const model = process.env["NULLCODE_MODEL"] ?? "qwen2.5-coder:7b";
    return {
      name: "ollama",
      model,
      async complete(system, user, jsonMode) {
        const data = await postJson(
          `${base.replace(/\/$/, "")}/api/chat`,
          {
            model,
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
            stream: false,
            ...(jsonMode ? { format: "json" } : {}),
            options: { temperature: 0 },
          },
          {},
          DEFAULT_TIMEOUT_MS + 60_000,
        );
        return extractText(data);
      },
    };
  }

  // Auto-detect a local Ollama install with a coding model — no config needed.
  const local = detectOllama();
  if (local.installed && local.model) {
    const base = process.env["OLLAMA_URL"] ?? "http://localhost:11434";
    return {
      name: "ollama",
      model: local.model,
      async complete(system, user, jsonMode) {
        const data = await postJson(
          `${base.replace(/\/$/, "")}/api/chat`,
          {
            model: local.model,
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
            stream: false,
            ...(jsonMode ? { format: "json" } : {}),
            options: { temperature: 0 },
          },
          {},
          DEFAULT_TIMEOUT_MS + 120_000,
        );
        return extractText(data);
      },
    };
  }

  return null;
}

export function describeProvider(): { configured: boolean; name?: string; model?: string } {
  const provider = resolveProvider();
  if (!provider) return { configured: false };
  return { configured: true, name: provider.name, model: provider.model };
}