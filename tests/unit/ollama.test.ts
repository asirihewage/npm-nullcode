import { describe, expect, it } from "vitest";
import { parseOllamaList, pickCodingModel, ollamaSetupHint } from "../../src/ai/ollama.js";

describe("ollama model discovery", () => {
  it("parses the ollama list table", () => {
    const output = [
      "NAME                       ID              SIZE      MODIFIED",
      "qwen2.5-coder:7b           abc123          4.7 GB    2 days ago",
      "qwen2.5:latest              def456          4.4 GB    5 days ago",
      "",
    ].join("\n");
    expect(parseOllamaList(output)).toEqual(["qwen2.5-coder:7b", "qwen2.5:latest"]);
  });

  it("prefers qwen coding models over generic ones", () => {
    expect(pickCodingModel(["llama3.1:latest", "qwen2.5-coder:7b"])).toBe("qwen2.5-coder:7b");
    expect(pickCodingModel(["qwen-coder:32b", "deepseek-coder-v2:16b"])).toBe("qwen-coder:32b");
    expect(pickCodingModel(["deepseek-coder-v2:16b", "llama3.2"])).toBe("deepseek-coder-v2:16b");
  });

  it("falls back to a coder-named or first available model", () => {
    expect(pickCodingModel(["llama3.2:3b", "codegemma:2b"])).toBe("codegemma:2b");
    expect(pickCodingModel(["llama3.1:8b"])).toBe("llama3.1:8b");
    expect(pickCodingModel([])).toBeNull();
  });

  it("asks the user to install ollama and pull qwen coder when unavailable", () => {
    const hint = ollamaSetupHint();
    expect(hint).toMatch(/Install Ollama/);
    expect(hint).toMatch(/ollama pull qwen2\.5-coder:7b/);
  });
});