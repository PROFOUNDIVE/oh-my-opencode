import { describe, expect, it } from "bun:test"

import { isModelAvailable } from "./model-availability"

describe("isModelAvailable", () => {
  it("returns true when model exists via fuzzy match", () => { expect(isModelAvailable("gpt-5.3-codex", new Set(["openai/gpt-5.3-codex", "anthropic/claude-opus-4-6"]))).toBe(true) })
  it("returns false when model not found", () => { expect(isModelAvailable("gpt-5.3-codex", new Set(["anthropic/claude-opus-4-6"]))).toBe(false) })
  it("returns false for empty available set", () => { expect(isModelAvailable("gpt-5.3-codex", new Set<string>())).toBe(false) })
})
