import { describe, expect, test } from "bun:test"

import { createInstallConfig } from "./install-config.test-fixture"
import { generateModelConfig } from "./model-fallback"

describe("generateModelConfig", () => {
  describe("single native provider", () => {
    test("uses Claude models when only Claude is available", () => {
      expect(generateModelConfig(createInstallConfig({ hasClaude: true }))).toMatchSnapshot()
    })
    test("uses Claude models with isMax20 flag", () => {
      expect(generateModelConfig(createInstallConfig({ hasClaude: true, isMax20: true }))).toMatchSnapshot()
    })
    test("uses OpenAI models when only OpenAI is available", () => {
      expect(generateModelConfig(createInstallConfig({ hasOpenAI: true }))).toMatchSnapshot()
    })
    test("uses OpenAI models with isMax20 flag", () => {
      expect(generateModelConfig(createInstallConfig({ hasOpenAI: true, isMax20: true }))).toMatchSnapshot()
    })
    test("uses Gemini models when only Gemini is available", () => {
      expect(generateModelConfig(createInstallConfig({ hasGemini: true }))).toMatchSnapshot()
    })
    test("uses Gemini models with isMax20 flag", () => {
      expect(generateModelConfig(createInstallConfig({ hasGemini: true, isMax20: true }))).toMatchSnapshot()
    })
  })

  describe("all native providers", () => {
    test("uses preferred models from fallback chains when all natives available", () => {
      expect(generateModelConfig(createInstallConfig({ hasClaude: true, hasOpenAI: true, hasGemini: true }))).toMatchSnapshot()
    })
    test("uses preferred models with isMax20 flag when all natives available", () => {
      expect(generateModelConfig(createInstallConfig({ hasClaude: true, hasOpenAI: true, hasGemini: true, isMax20: true }))).toMatchSnapshot()
    })
  })
})
