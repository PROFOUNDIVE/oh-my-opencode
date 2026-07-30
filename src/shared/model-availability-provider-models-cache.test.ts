import { afterEach, beforeEach, describe, expect, it } from "bun:test"

import { createModelCacheFixture, type ModelCacheFixture } from "./model-availability.test-fixture"
import { __resetModelCache, fetchAvailableModels, fuzzyMatchModel } from "./model-availability"

describe("fetchAvailableModels with provider-models cache (whitelist-filtered)", () => {
  let fixture: ModelCacheFixture
  let originalXdgCache: string | undefined
  beforeEach(() => { __resetModelCache(); fixture = createModelCacheFixture(); originalXdgCache = process.env.XDG_CACHE_HOME; process.env.XDG_CACHE_HOME = fixture.tempDir })
  afterEach(() => { if (originalXdgCache === undefined) delete process.env.XDG_CACHE_HOME; else process.env.XDG_CACHE_HOME = originalXdgCache; fixture.cleanup() })

  it("should prefer provider-models cache over models.json", async () => {
    fixture.writeProviderModelsCache({ models: { opencode: ["glm-4.7-free", "gpt-5-nano"], anthropic: ["claude-opus-4-6"] }, connected: ["opencode", "anthropic"] })
    fixture.writeModelsCache({ opencode: { models: { "glm-4.7-free": {}, "gpt-5-nano": {}, "gpt-5.2": {} } }, anthropic: { models: { "claude-opus-4-6": {}, "claude-sonnet-4-6": {} } } })
    const result = await fetchAvailableModels(undefined, { connectedProviders: ["opencode", "anthropic"] })
    expect(result.size).toBe(3); expect(result.has("opencode/glm-4.7-free")).toBe(true); expect(result.has("opencode/gpt-5-nano")).toBe(true); expect(result.has("anthropic/claude-opus-4-6")).toBe(true); expect(result.has("opencode/gpt-5.2")).toBe(false); expect(result.has("anthropic/claude-sonnet-4-6")).toBe(false)
  })
  it("should fall back to models.json when provider-models cache is empty", async () => {
    fixture.writeProviderModelsCache({ models: {}, connected: ["google"] }); fixture.writeModelsCache({ google: { models: { "gemini-3-flash-preview": {} } } })
    const availableModels = await fetchAvailableModels(undefined, { connectedProviders: ["google"] })
    expect(fuzzyMatchModel("google/gemini-3-flash", availableModels, ["google"])).toBe("google/gemini-3-flash-preview")
  })
  it("should fallback to models.json when provider-models cache not found", async () => {
    fixture.writeModelsCache({ opencode: { models: { "glm-4.7-free": {}, "gpt-5-nano": {}, "gpt-5.2": {} } } })
    const result = await fetchAvailableModels(undefined, { connectedProviders: ["opencode"] })
    expect(result.size).toBe(3); expect(result.has("opencode/glm-4.7-free")).toBe(true); expect(result.has("opencode/gpt-5-nano")).toBe(true); expect(result.has("opencode/gpt-5.2")).toBe(true)
  })
  it("should filter by connectedProviders even with provider-models cache", async () => {
    fixture.writeProviderModelsCache({ models: { opencode: ["glm-4.7-free"], anthropic: ["claude-opus-4-6"], google: ["gemini-3-pro"] }, connected: ["opencode", "anthropic", "google"] })
    const result = await fetchAvailableModels(undefined, { connectedProviders: ["opencode"] })
    expect(result.size).toBe(1); expect(result.has("opencode/glm-4.7-free")).toBe(true); expect(result.has("anthropic/claude-opus-4-6")).toBe(false); expect(result.has("google/gemini-3-pro")).toBe(false)
  })
  it("should handle object[] format with metadata (Ollama-style)", async () => {
    fixture.writeProviderModelsCache({ models: { ollama: [{ id: "ministral-3:14b-32k-agent", provider: "ollama", context: 32768, output: 8192 }, { id: "qwen3-coder:32k-agent", provider: "ollama", context: 32768, output: 8192 }] }, connected: ["ollama"] })
    const result = await fetchAvailableModels(undefined, { connectedProviders: ["ollama"] })
    expect(result.size).toBe(2); expect(result.has("ollama/ministral-3:14b-32k-agent")).toBe(true); expect(result.has("ollama/qwen3-coder:32k-agent")).toBe(true)
  })
  it("should handle mixed string[] and object[] formats across providers", async () => {
    fixture.writeProviderModelsCache({ models: { anthropic: ["claude-opus-4-6", "claude-sonnet-4-6"], ollama: [{ id: "ministral-3:14b-32k-agent", provider: "ollama" }, { id: "qwen3-coder:32k-agent", provider: "ollama" }] }, connected: ["anthropic", "ollama"] })
    const result = await fetchAvailableModels(undefined, { connectedProviders: ["anthropic", "ollama"] })
    expect(result.size).toBe(4); expect(result.has("anthropic/claude-opus-4-6")).toBe(true); expect(result.has("anthropic/claude-sonnet-4-6")).toBe(true); expect(result.has("ollama/ministral-3:14b-32k-agent")).toBe(true); expect(result.has("ollama/qwen3-coder:32k-agent")).toBe(true)
  })
  it("should skip invalid entries in object[] format", async () => {
    fixture.writeProviderModelsCache({ models: { ollama: [{ id: "valid-model", provider: "ollama" }, { provider: "ollama" }, { id: "", provider: "ollama" }, null, "string-model"] }, connected: ["ollama"] })
    const result = await fetchAvailableModels(undefined, { connectedProviders: ["ollama"] })
    expect(result.size).toBe(2); expect(result.has("ollama/valid-model")).toBe(true); expect(result.has("ollama/string-model")).toBe(true)
  })
})
