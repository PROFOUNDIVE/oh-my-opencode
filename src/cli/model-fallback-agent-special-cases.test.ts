import { describe, expect, test } from "bun:test"

import { createInstallConfig } from "./install-config.test-fixture"
import { generateModelConfig } from "./model-fallback"

describe("generateModelConfig", () => {
  describe("explore agent special cases", () => {
    test("explore uses gpt-5-nano when only Gemini available (no Claude)", () => {
      expect(generateModelConfig(createInstallConfig({ hasGemini: true })).agents?.explore?.model).toBe("opencode/gpt-5-nano")
    })
    test("explore uses Claude haiku when Claude available", () => {
      expect(generateModelConfig(createInstallConfig({ hasClaude: true, isMax20: true })).agents?.explore?.model).toBe("anthropic/claude-haiku-4-5")
    })
    test("explore uses Claude haiku regardless of isMax20 flag", () => {
      expect(generateModelConfig(createInstallConfig({ hasClaude: true })).agents?.explore?.model).toBe("anthropic/claude-haiku-4-5")
    })
    test("explore uses gpt-5-nano when only OpenAI available", () => {
      expect(generateModelConfig(createInstallConfig({ hasOpenAI: true })).agents?.explore?.model).toBe("opencode/gpt-5-nano")
    })
    test("explore uses gpt-5-mini when only Copilot available", () => {
      expect(generateModelConfig(createInstallConfig({ hasCopilot: true })).agents?.explore?.model).toBe("github-copilot/gpt-5-mini")
    })
  })

  describe("Sisyphus agent special cases", () => {
    test("Sisyphus is created when at least one fallback provider is available (Claude)", () => {
      expect(generateModelConfig(createInstallConfig({ hasClaude: true, isMax20: true })).agents?.sisyphus?.model).toBe("anthropic/claude-opus-4-6")
    })
    test("Sisyphus is created when multiple fallback providers are available", () => {
      expect(generateModelConfig(createInstallConfig({ hasClaude: true, hasKimiForCoding: true, hasOpencodeZen: true, hasZaiCodingPlan: true, isMax20: true })).agents?.sisyphus?.model).toBe("anthropic/claude-opus-4-6")
    })
    test("Sisyphus is omitted when no fallback provider is available (OpenAI not in chain)", () => {
      expect(generateModelConfig(createInstallConfig({ hasOpenAI: true })).agents?.sisyphus).toBeUndefined()
    })
  })

  describe("Hephaestus agent special cases", () => {
    test("Hephaestus is created when OpenAI is available (openai provider connected)", () => {
      const agent = generateModelConfig(createInstallConfig({ hasOpenAI: true })).agents?.hephaestus
      expect(agent?.model).toBe("openai/gpt-5.3-codex")
      expect(agent?.variant).toBe("medium")
    })
    test("Hephaestus is created when Copilot is available (github-copilot provider connected)", () => {
      const agent = generateModelConfig(createInstallConfig({ hasCopilot: true })).agents?.hephaestus
      expect(agent?.model).toBe("github-copilot/gpt-5.3-codex")
      expect(agent?.variant).toBe("medium")
    })
    test("Hephaestus is created when OpenCode Zen is available (opencode provider connected)", () => {
      const agent = generateModelConfig(createInstallConfig({ hasOpencodeZen: true })).agents?.hephaestus
      expect(agent?.model).toBe("opencode/gpt-5.3-codex")
      expect(agent?.variant).toBe("medium")
    })
    test("Hephaestus is omitted when only Claude is available (no required provider connected)", () => {
      expect(generateModelConfig(createInstallConfig({ hasClaude: true })).agents?.hephaestus).toBeUndefined()
    })
    test("Hephaestus is omitted when only Gemini is available (no required provider connected)", () => {
      expect(generateModelConfig(createInstallConfig({ hasGemini: true })).agents?.hephaestus).toBeUndefined()
    })
    test("Hephaestus is omitted when only ZAI is available (no required provider connected)", () => {
      expect(generateModelConfig(createInstallConfig({ hasZaiCodingPlan: true })).agents?.hephaestus).toBeUndefined()
    })
  })

  describe("librarian agent special cases", () => {
    test("librarian uses ZAI when ZAI is available regardless of other providers", () => {
      expect(generateModelConfig(createInstallConfig({ hasClaude: true, hasZaiCodingPlan: true })).agents?.librarian?.model).toBe("zai-coding-plan/glm-4.7")
    })
    test("librarian uses claude-sonnet when ZAI not available but Claude is", () => {
      expect(generateModelConfig(createInstallConfig({ hasClaude: true })).agents?.librarian?.model).toBe("anthropic/claude-sonnet-4-6")
    })
  })
})
