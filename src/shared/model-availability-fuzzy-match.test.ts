import { describe, expect, it } from "bun:test"

import { fuzzyMatchModel } from "./model-availability"

describe("fuzzyMatchModel", () => {
  it("should match substring in model name", () => { expect(fuzzyMatchModel("gpt-5.2", new Set(["openai/gpt-5.2", "openai/gpt-5.3-codex", "anthropic/claude-opus-4-6"]))).toBe("openai/gpt-5.2") })
  it("should match preview suffix for gemini-3-flash", () => { expect(fuzzyMatchModel("google/gemini-3-flash", new Set(["google/gemini-3-flash-preview"]), ["google"])).toBe("google/gemini-3-flash-preview") })
  it("should prefer exact match over substring match", () => { expect(fuzzyMatchModel("gpt-5.2", new Set(["openai/gpt-5.2", "openai/gpt-5.3-codex", "openai/gpt-5.2-ultra"]))).toBe("openai/gpt-5.2") })
  it("should prefer shorter model name when multiple matches exist", () => { expect(fuzzyMatchModel("gpt-5.2", new Set(["openai/gpt-5.2-ultra", "openai/gpt-5.2-ultra-mega"]))).toBe("openai/gpt-5.2-ultra") })
  it("should match claude-opus to claude-opus-4-6", () => { expect(fuzzyMatchModel("claude-opus", new Set(["anthropic/claude-opus-4-6", "anthropic/claude-sonnet-4-6"]))).toBe("anthropic/claude-opus-4-6") })
  it("should match github-copilot claude-opus-4-6 to claude-opus-4.6", () => { expect(fuzzyMatchModel("claude-opus-4-6", new Set(["github-copilot/claude-opus-4.6", "opencode/glm-4.7-free"]), ["github-copilot"])).toBe("github-copilot/claude-opus-4.6") })
  it("should normalize claude version separators for future versions", () => { expect(fuzzyMatchModel("claude-sonnet-5-1", new Set(["github-copilot/claude-sonnet-5.1"]), ["github-copilot"])).toBe("github-copilot/claude-sonnet-5.1") })
  it("should filter by provider when providers array is given", () => { expect(fuzzyMatchModel("gpt", new Set(["openai/gpt-5.2", "anthropic/claude-opus-4-6", "google/gemini-3"]), ["openai"])).toBe("openai/gpt-5.2") })
  it("should return null when provider filter excludes all matches", () => { expect(fuzzyMatchModel("claude", new Set(["openai/gpt-5.2", "anthropic/claude-opus-4-6"]), ["openai"])).toBeNull() })
  it("should return null when no match found", () => { expect(fuzzyMatchModel("gemini", new Set(["openai/gpt-5.2", "anthropic/claude-opus-4-6"]))).toBeNull() })
  it("should match case-insensitively", () => { expect(fuzzyMatchModel("GPT-5.2", new Set(["openai/gpt-5.2", "anthropic/claude-opus-4-6"]))).toBe("openai/gpt-5.2") })
  it("should prioritize exact match over longer variants", () => { expect(fuzzyMatchModel("claude-opus-4-6", new Set(["anthropic/claude-opus-4-6", "anthropic/claude-opus-4-6-extended"]))).toBe("anthropic/claude-opus-4-6") })
  it("should prefer exact model ID match over shorter substring match", () => { expect(fuzzyMatchModel("glm-4.7-free", new Set(["zai-coding-plan/glm-4.7", "zai-coding-plan/glm-4.7-free"]))).toBe("zai-coding-plan/glm-4.7-free") })
  it("should still prefer shorter match when searching for shorter variant", () => { expect(fuzzyMatchModel("glm-4.7", new Set(["zai-coding-plan/glm-4.7", "zai-coding-plan/glm-4.7-free"]))).toBe("zai-coding-plan/glm-4.7") })
  it("should use shortest tie-break when multiple providers have same model ID", () => { expect(fuzzyMatchModel("gpt-5.2", new Set(["opencode/gpt-5.2", "openai/gpt-5.2"]))).toBe("openai/gpt-5.2") })
  it("should search all specified providers", () => { expect(fuzzyMatchModel("gpt", new Set(["openai/gpt-5.2", "anthropic/claude-opus-4-6", "google/gemini-3"]), ["openai", "google"])).toBe("openai/gpt-5.2") })
  it("should only match models with correct provider prefix", () => { expect(fuzzyMatchModel("gpt", new Set(["openai/gpt-5.2", "anthropic/gpt-something"]), ["openai"])).toBe("openai/gpt-5.2") })
  it("should return null for empty available set", () => { expect(fuzzyMatchModel("gpt", new Set<string>())).toBeNull() })
})
