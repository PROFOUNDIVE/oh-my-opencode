import { describe, expect, test } from "bun:test"

import { generateOmoConfig } from "./config-manager"
import { createInstallConfig } from "./install-config.test-fixture"

type AgentConfig = { model: string; variant?: string; ultrawork?: { model: string; variant?: string } }

function getAgents(result: Record<string, unknown>): Record<string, AgentConfig> {
  return result.agents as Record<string, AgentConfig>
}

describe("generateOmoConfig - model fallback system", () => {
  test("generates sonnet model with ultrawork opus for Claude standard subscription", () => {
    const result = generateOmoConfig(createInstallConfig({ hasClaude: true }))
    const sisyphus = getAgents(result).sisyphus
    expect(result.$schema).toBe("https://raw.githubusercontent.com/code-yeongyu/oh-my-opencode/master/assets/oh-my-openmath.schema.json")
    expect(sisyphus.model).toBe("anthropic/claude-sonnet-4-6")
    expect(sisyphus.variant).toBe("max")
    expect(sisyphus.ultrawork).toEqual({ model: "anthropic/claude-opus-4-6", variant: "max" })
  })

  test("generates native opus models without ultrawork when Claude max20 subscription", () => {
    const sisyphus = getAgents(generateOmoConfig(createInstallConfig({ hasClaude: true, isMax20: true }))).sisyphus
    expect(sisyphus.model).toBe("anthropic/claude-opus-4-6")
    expect(sisyphus.ultrawork).toBeUndefined()
  })

  test("uses github-copilot sonnet fallback when only copilot available", () => {
    expect(getAgents(generateOmoConfig(createInstallConfig({ hasCopilot: true }))).sisyphus.model).toBe("github-copilot/claude-opus-4.6")
  })

  test("uses ultimate fallback when no providers configured", () => {
    const result = generateOmoConfig(createInstallConfig())
    expect(result.$schema).toBe("https://raw.githubusercontent.com/code-yeongyu/oh-my-opencode/master/assets/oh-my-openmath.schema.json")
    expect(getAgents(result).sisyphus).toBeUndefined()
  })

  test("uses zai-coding-plan/glm-4.7 for librarian when Z.ai available", () => {
    const agents = getAgents(generateOmoConfig(createInstallConfig({ hasClaude: true, isMax20: true, hasZaiCodingPlan: true })))
    expect(agents.librarian.model).toBe("zai-coding-plan/glm-4.7")
    expect(agents.sisyphus.model).toBe("anthropic/claude-opus-4-6")
  })

  test("uses native OpenAI models when only ChatGPT available", () => {
    const agents = getAgents(generateOmoConfig(createInstallConfig({ hasOpenAI: true })))
    expect(agents.sisyphus).toBeUndefined()
    expect(agents.oracle.model).toBe("openai/gpt-5.2")
    expect(agents["multimodal-looker"].model).toBe("openai/gpt-5.2")
  })

  test("uses haiku for explore when Claude max20", () => {
    expect(getAgents(generateOmoConfig(createInstallConfig({ hasClaude: true, isMax20: true }))).explore.model).toBe("anthropic/claude-haiku-4-5")
  })

  test("uses haiku for explore regardless of max20 flag", () => {
    expect(getAgents(generateOmoConfig(createInstallConfig({ hasClaude: true }))).explore.model).toBe("anthropic/claude-haiku-4-5")
  })
})
