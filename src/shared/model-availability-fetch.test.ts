import { afterEach, beforeEach, describe, expect, it } from "bun:test"

import { createModelCacheFixture, type ModelCacheFixture } from "./model-availability.test-fixture"
import { __resetModelCache, fetchAvailableModels } from "./model-availability"

describe("fetchAvailableModels", () => {
  let fixture: ModelCacheFixture
  let originalXdgCache: string | undefined

  beforeEach(() => {
    __resetModelCache()
    fixture = createModelCacheFixture()
    originalXdgCache = process.env.XDG_CACHE_HOME
    process.env.XDG_CACHE_HOME = fixture.tempDir
  })
  afterEach(() => {
    if (originalXdgCache === undefined) delete process.env.XDG_CACHE_HOME
    else process.env.XDG_CACHE_HOME = originalXdgCache
    fixture.cleanup()
  })

  it("#given cache file with models #when fetchAvailableModels called with connectedProviders #then returns Set of model IDs", async () => {
    fixture.writeModelsCache({ openai: { id: "openai", models: { "gpt-5.2": { id: "gpt-5.2" } } }, anthropic: { id: "anthropic", models: { "claude-opus-4-6": { id: "claude-opus-4-6" } } }, google: { id: "google", models: { "gemini-3-pro": { id: "gemini-3-pro" } } } })
    const result = await fetchAvailableModels(undefined, { connectedProviders: ["openai", "anthropic", "google"] })
    expect(result).toBeInstanceOf(Set); expect(result.size).toBe(3); expect(result.has("openai/gpt-5.2")).toBe(true); expect(result.has("anthropic/claude-opus-4-6")).toBe(true); expect(result.has("google/gemini-3-pro")).toBe(true)
  })
  it("#given connectedProviders unknown #when fetchAvailableModels called without options #then returns empty Set", async () => {
    fixture.writeModelsCache({ openai: { id: "openai", models: { "gpt-5.2": { id: "gpt-5.2" } } } })
    const result = await fetchAvailableModels()
    expect(result).toBeInstanceOf(Set); expect(result.size).toBe(0)
  })
  it("#given connectedProviders unknown but client can list #when fetchAvailableModels called with client #then returns models from API filtered by connected providers", async () => {
    const client = { provider: { list: async () => ({ data: { connected: ["openai"] } }) }, model: { list: async () => ({ data: [{ id: "gpt-5.3-codex", provider: "openai" }, { id: "gemini-3-pro", provider: "google" }] }) } }
    const result = await fetchAvailableModels(client)
    expect(result).toBeInstanceOf(Set); expect(result.has("openai/gpt-5.3-codex")).toBe(true); expect(result.has("google/gemini-3-pro")).toBe(false)
  })
  it("#given cache file not found #when fetchAvailableModels called with connectedProviders #then returns empty Set", async () => {
    const result = await fetchAvailableModels(undefined, { connectedProviders: ["openai"] })
    expect(result).toBeInstanceOf(Set); expect(result.size).toBe(0)
  })
  it("#given cache missing but client can list #when fetchAvailableModels called with connectedProviders #then returns models from API", async () => {
    const client = { provider: { list: async () => ({ data: { connected: ["openai", "google"] } }) }, model: { list: async () => ({ data: [{ id: "gpt-5.3-codex", provider: "openai" }, { id: "gemini-3-pro", provider: "google" }] }) } }
    const result = await fetchAvailableModels(client, { connectedProviders: ["openai", "google"] })
    expect(result).toBeInstanceOf(Set); expect(result.has("openai/gpt-5.3-codex")).toBe(true); expect(result.has("google/gemini-3-pro")).toBe(true)
  })
  it("#given cache read twice #when second call made with same providers #then reads fresh each time", async () => {
    fixture.writeModelsCache({ openai: { id: "openai", models: { "gpt-5.2": { id: "gpt-5.2" } } }, anthropic: { id: "anthropic", models: { "claude-opus-4-6": { id: "claude-opus-4-6" } } } })
    const result1 = await fetchAvailableModels(undefined, { connectedProviders: ["openai"] }); const result2 = await fetchAvailableModels(undefined, { connectedProviders: ["openai"] })
    expect(result1.size).toBe(result2.size); expect(result1.has("openai/gpt-5.2")).toBe(true)
  })
  it("#given empty providers in cache #when fetchAvailableModels called with connectedProviders #then returns empty Set", async () => {
    fixture.writeModelsCache({})
    const result = await fetchAvailableModels(undefined, { connectedProviders: ["openai"] })
    expect(result).toBeInstanceOf(Set); expect(result.size).toBe(0)
  })
  it("#given cache file with various providers #when fetchAvailableModels called with all providers #then extracts all IDs correctly", async () => {
    fixture.writeModelsCache({ openai: { id: "openai", models: { "gpt-5.3-codex": { id: "gpt-5.3-codex" } } }, anthropic: { id: "anthropic", models: { "claude-sonnet-4-6": { id: "claude-sonnet-4-6" } } }, google: { id: "google", models: { "gemini-3-flash": { id: "gemini-3-flash" } } }, opencode: { id: "opencode", models: { "gpt-5-nano": { id: "gpt-5-nano" } } } })
    const result = await fetchAvailableModels(undefined, { connectedProviders: ["openai", "anthropic", "google", "opencode"] })
    expect(result.size).toBe(4); expect(result.has("openai/gpt-5.3-codex")).toBe(true); expect(result.has("anthropic/claude-sonnet-4-6")).toBe(true); expect(result.has("google/gemini-3-flash")).toBe(true); expect(result.has("opencode/gpt-5-nano")).toBe(true)
  })
})
