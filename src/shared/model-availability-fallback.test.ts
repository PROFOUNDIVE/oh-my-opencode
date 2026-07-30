import { afterEach, beforeEach, describe, expect, it } from "bun:test"

import { isAnyFallbackModelAvailable, resolveFirstAvailableFallback } from "./fallback-model-availability"
import { createModelCacheFixture, type ModelCacheFixture } from "./model-availability.test-fixture"
import { fuzzyMatchModel } from "./model-availability"

describe("fallback model availability", () => {
  let fixture: ModelCacheFixture
  let originalXdgCache: string | undefined
  beforeEach(() => { fixture = createModelCacheFixture(); originalXdgCache = process.env.XDG_CACHE_HOME; process.env.XDG_CACHE_HOME = fixture.tempDir })
  afterEach(() => { if (originalXdgCache === undefined) delete process.env.XDG_CACHE_HOME; else process.env.XDG_CACHE_HOME = originalXdgCache; fixture.cleanup() })

  it("returns null for completely unknown model", () => { expect(fuzzyMatchModel("non-existent-model-family", new Set(["openai/gpt-5.2", "anthropic/claude-opus-4-6"]))).toBeNull() })
  it("returns true when models do not match but provider is connected", () => {
    fixture.writeConnectedProvidersCache(["openai"])
    expect(isAnyFallbackModelAvailable([{ providers: ["openai"], model: "gpt-5.2" }], new Set(["anthropic/claude-opus-4-6"]))).toBe(true)
  })
  it("returns first resolved fallback model from chain", () => {
    expect(resolveFirstAvailableFallback([{ providers: ["openai"], model: "gpt-5.2" }, { providers: ["anthropic"], model: "claude-opus-4-6" }], new Set(["anthropic/claude-opus-4-6", "openai/gpt-5.2-preview"]))).toEqual({ provider: "openai", model: "openai/gpt-5.2-preview" })
  })
  it("returns null when no fallback model resolves", () => {
    expect(resolveFirstAvailableFallback([{ providers: ["openai"], model: "gpt-5.2" }, { providers: ["anthropic"], model: "claude-opus-4-6" }], new Set(["google/gemini-3-pro"]))).toBeNull()
  })
})
