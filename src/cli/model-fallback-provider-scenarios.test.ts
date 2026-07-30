import { describe, expect, test } from "bun:test"

import { createInstallConfig } from "./install-config.test-fixture"
import { generateModelConfig } from "./model-fallback"

describe("generateModelConfig", () => {
  describe("fallback providers", () => {
    test("uses OpenCode Zen models when only OpenCode Zen is available", () => {
      expect(generateModelConfig(createInstallConfig({ hasOpencodeZen: true }))).toMatchSnapshot()
    })
    test("uses OpenCode Zen models with isMax20 flag", () => {
      expect(generateModelConfig(createInstallConfig({ hasOpencodeZen: true, isMax20: true }))).toMatchSnapshot()
    })
    test("uses GitHub Copilot models when only Copilot is available", () => {
      expect(generateModelConfig(createInstallConfig({ hasCopilot: true }))).toMatchSnapshot()
    })
    test("uses GitHub Copilot models with isMax20 flag", () => {
      expect(generateModelConfig(createInstallConfig({ hasCopilot: true, isMax20: true }))).toMatchSnapshot()
    })
    test("uses ZAI model for librarian when only ZAI is available", () => {
      expect(generateModelConfig(createInstallConfig({ hasZaiCodingPlan: true }))).toMatchSnapshot()
    })
    test("uses ZAI model for librarian with isMax20 flag", () => {
      expect(generateModelConfig(createInstallConfig({ hasZaiCodingPlan: true, isMax20: true }))).toMatchSnapshot()
    })
  })

  describe("mixed provider scenarios", () => {
    test("uses Claude + OpenCode Zen combination", () => {
      expect(generateModelConfig(createInstallConfig({ hasClaude: true, hasOpencodeZen: true }))).toMatchSnapshot()
    })
    test("uses OpenAI + Copilot combination", () => {
      expect(generateModelConfig(createInstallConfig({ hasOpenAI: true, hasCopilot: true }))).toMatchSnapshot()
    })
    test("uses Claude + ZAI combination (librarian uses ZAI)", () => {
      expect(generateModelConfig(createInstallConfig({ hasClaude: true, hasZaiCodingPlan: true }))).toMatchSnapshot()
    })
    test("uses Gemini + Claude combination (explore uses Gemini)", () => {
      expect(generateModelConfig(createInstallConfig({ hasGemini: true, hasClaude: true }))).toMatchSnapshot()
    })
    test("uses all fallback providers together", () => {
      expect(generateModelConfig(createInstallConfig({ hasOpencodeZen: true, hasCopilot: true, hasZaiCodingPlan: true }))).toMatchSnapshot()
    })
    test("uses all providers together", () => {
      expect(generateModelConfig(createInstallConfig({ hasClaude: true, hasOpenAI: true, hasGemini: true, hasOpencodeZen: true, hasCopilot: true, hasZaiCodingPlan: true }))).toMatchSnapshot()
    })
    test("uses all providers with isMax20 flag", () => {
      expect(generateModelConfig(createInstallConfig({ hasClaude: true, hasOpenAI: true, hasGemini: true, hasOpencodeZen: true, hasCopilot: true, hasZaiCodingPlan: true, isMax20: true }))).toMatchSnapshot()
    })
  })
})
