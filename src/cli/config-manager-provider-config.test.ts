import { describe, expect, test } from "bun:test"

import { ANTIGRAVITY_PROVIDER_CONFIG } from "./config-manager"

describe("config-manager ANTIGRAVITY_PROVIDER_CONFIG", () => {
  test("all models include full spec (limit + modalities + Antigravity label)", () => {
    const google: typeof ANTIGRAVITY_PROVIDER_CONFIG.google = ANTIGRAVITY_PROVIDER_CONFIG.google
    const models: typeof ANTIGRAVITY_PROVIDER_CONFIG.google.models = google.models
    expect(google).toBeTruthy()
    expect(models).toBeTruthy()
    const required = [models["antigravity-gemini-3-pro"], models["antigravity-gemini-3-flash"], models["antigravity-claude-sonnet-4-6"], models["antigravity-claude-sonnet-4-6-thinking"], models["antigravity-claude-opus-4-5-thinking"]]

    for (const model of required) {
      expect(model).toBeTruthy()
      expect(typeof model.name).toBe("string")
      expect(model.name.includes("(Antigravity)")).toBe(true)
      expect(model.limit).toBeTruthy()
      expect(typeof model.limit.context).toBe("number")
      expect(typeof model.limit.output).toBe("number")
      expect(model.modalities).toBeTruthy()
      expect(Array.isArray(model.modalities.input)).toBe(true)
      expect(Array.isArray(model.modalities.output)).toBe(true)
    }
  })

  test("Gemini models have variant definitions", () => {
    const models: typeof ANTIGRAVITY_PROVIDER_CONFIG.google.models = ANTIGRAVITY_PROVIDER_CONFIG.google.models
    const pro = models["antigravity-gemini-3-pro"]
    expect(pro.variants).toBeTruthy()
    expect(pro.variants.low).toBeTruthy()
    expect(pro.variants.high).toBeTruthy()
    const flash = models["antigravity-gemini-3-flash"]
    expect(flash.variants).toBeTruthy()
    expect(flash.variants.minimal).toBeTruthy()
    expect(flash.variants.low).toBeTruthy()
    expect(flash.variants.medium).toBeTruthy()
    expect(flash.variants.high).toBeTruthy()
  })

  test("Claude thinking models have variant definitions", () => {
    const models: typeof ANTIGRAVITY_PROVIDER_CONFIG.google.models = ANTIGRAVITY_PROVIDER_CONFIG.google.models
    const thinkingModels = [models["antigravity-claude-sonnet-4-6-thinking"], models["antigravity-claude-opus-4-5-thinking"]]
    for (const model of thinkingModels) {
      expect(model.variants).toBeTruthy()
      expect(model.variants.low).toBeTruthy()
      expect(model.variants.max).toBeTruthy()
    }
  })
})
