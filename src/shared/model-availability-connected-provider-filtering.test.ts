import { afterEach, beforeEach, describe, expect, it } from "bun:test"

import { createModelCacheFixture, type ModelCacheFixture } from "./model-availability.test-fixture"
import { __resetModelCache, fetchAvailableModels } from "./model-availability"

describe("fetchAvailableModels with connected providers filtering", () => {
  let fixture: ModelCacheFixture
  let originalXdgCache: string | undefined
  beforeEach(() => { __resetModelCache(); fixture = createModelCacheFixture(); originalXdgCache = process.env.XDG_CACHE_HOME; process.env.XDG_CACHE_HOME = fixture.tempDir })
  afterEach(() => { if (originalXdgCache === undefined) delete process.env.XDG_CACHE_HOME; else process.env.XDG_CACHE_HOME = originalXdgCache; fixture.cleanup() })

  it("should filter models by connected providers", async () => {
    fixture.writeModelsCache({ openai: { models: { "gpt-5.2": { id: "gpt-5.2" } } }, anthropic: { models: { "claude-opus-4-6": { id: "claude-opus-4-6" } } }, google: { models: { "gemini-3-pro": { id: "gemini-3-pro" } } } })
    const result = await fetchAvailableModels(undefined, { connectedProviders: ["anthropic"] })
    expect(result.size).toBe(1); expect(result.has("anthropic/claude-opus-4-6")).toBe(true); expect(result.has("openai/gpt-5.2")).toBe(false); expect(result.has("google/gemini-3-pro")).toBe(false)
  })
  it("should filter models by multiple connected providers", async () => {
    fixture.writeModelsCache({ openai: { models: { "gpt-5.2": { id: "gpt-5.2" } } }, anthropic: { models: { "claude-opus-4-6": { id: "claude-opus-4-6" } } }, google: { models: { "gemini-3-pro": { id: "gemini-3-pro" } } } })
    const result = await fetchAvailableModels(undefined, { connectedProviders: ["anthropic", "google"] })
    expect(result.size).toBe(2); expect(result.has("anthropic/claude-opus-4-6")).toBe(true); expect(result.has("google/gemini-3-pro")).toBe(true); expect(result.has("openai/gpt-5.2")).toBe(false)
  })
  it("should return empty set when connectedProviders is empty", async () => {
    fixture.writeModelsCache({ openai: { models: { "gpt-5.2": { id: "gpt-5.2" } } }, anthropic: { models: { "claude-opus-4-6": { id: "claude-opus-4-6" } } } })
    expect((await fetchAvailableModels(undefined, { connectedProviders: [] })).size).toBe(0)
  })
  it("should return empty set when connectedProviders not specified", async () => {
    fixture.writeModelsCache({ openai: { models: { "gpt-5.2": { id: "gpt-5.2" } } }, anthropic: { models: { "claude-opus-4-6": { id: "claude-opus-4-6" } } } })
    expect((await fetchAvailableModels()).size).toBe(0)
  })
  it("should handle provider not in cache gracefully", async () => {
    fixture.writeModelsCache({ openai: { models: { "gpt-5.2": { id: "gpt-5.2" } } } })
    expect((await fetchAvailableModels(undefined, { connectedProviders: ["azure"] })).size).toBe(0)
  })
  it("should return models from providers that exist in both cache and connected list", async () => {
    fixture.writeModelsCache({ openai: { models: { "gpt-5.2": { id: "gpt-5.2" } } }, anthropic: { models: { "claude-opus-4-6": { id: "claude-opus-4-6" } } } })
    const result = await fetchAvailableModels(undefined, { connectedProviders: ["anthropic", "azure", "unknown"] })
    expect(result.size).toBe(1); expect(result.has("anthropic/claude-opus-4-6")).toBe(true)
  })
  it("should not cache filtered results", async () => {
    fixture.writeModelsCache({ openai: { models: { "gpt-5.2": { id: "gpt-5.2" } } }, anthropic: { models: { "claude-opus-4-6": { id: "claude-opus-4-6" } } } })
    const result1 = await fetchAvailableModels(undefined, { connectedProviders: ["anthropic"] }); const result2 = await fetchAvailableModels(undefined, { connectedProviders: ["openai"] })
    expect(result1.size).toBe(1); expect(result2.size).toBe(1); expect(result2.has("openai/gpt-5.2")).toBe(true)
  })
  it("should return empty set when connectedProviders unknown", async () => {
    fixture.writeModelsCache({ openai: { models: { "gpt-5.2": { id: "gpt-5.2" } } } })
    const result1 = await fetchAvailableModels(); const result2 = await fetchAvailableModels()
    expect(result1.size).toBe(0); expect(result2.size).toBe(0)
  })
})
