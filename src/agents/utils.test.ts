import { describe, test, expect, spyOn } from "bun:test"
import { createBuiltinAgents } from "./builtin-agents"
import * as modelAvailability from "../shared/model-availability"

const TEST_DEFAULT_MODEL = "anthropic/claude-opus-4-6"

describe("createBuiltinAgents", () => {
  test("registers only OpenMath-scope builtins by default", async () => {
    const agents = await createBuiltinAgents([], {}, undefined, TEST_DEFAULT_MODEL)

    expect(agents.sisyphus).toBeDefined()
    expect(agents["multimodal-looker"]).toBeDefined()
    expect(agents.solver).toBeDefined()
    expect(agents["reference-reviewer"]).toBeDefined()
    expect(agents.verifier).toBeDefined()
    expect(agents.coach).toBeDefined()

    expect(agents.hephaestus).toBeUndefined()
    expect(agents.oracle).toBeUndefined()
    expect(agents.librarian).toBeUndefined()
    expect(agents.explore).toBeUndefined()
    expect(agents.metis).toBeUndefined()
    expect(agents.momus).toBeUndefined()
    expect(agents.atlas).toBeUndefined()
  })

  test("respects disabled_agents for remaining builtins", async () => {
    const agents = await createBuiltinAgents(
      ["solver", "reference-reviewer", "verifier", "coach", "multimodal-looker"],
      {},
      undefined,
      TEST_DEFAULT_MODEL,
    )

    expect(agents.solver).toBeUndefined()
    expect(agents["reference-reviewer"]).toBeUndefined()
    expect(agents.verifier).toBeUndefined()
    expect(agents.coach).toBeUndefined()
    expect(agents["multimodal-looker"]).toBeUndefined()
    expect(agents.sisyphus).toBeDefined()
  })

  test("applies user model override for sisyphus", async () => {
    const agents = await createBuiltinAgents(
      [],
      { sisyphus: { model: "github-copilot/gpt-5.2" } },
      undefined,
      TEST_DEFAULT_MODEL,
    )

    expect(agents.sisyphus.model).toBe("github-copilot/gpt-5.2")
    expect(agents.sisyphus.reasoningEffort).toBe("medium")
    expect(agents.sisyphus.thinking).toBeUndefined()
  })

  test("includes custom agents in sisyphus prompt metadata", async () => {
    const customAgentSummaries = [
      {
        name: "researcher",
        description: "Research agent for deep analysis",
        hidden: false,
      },
    ]

    const agents = await createBuiltinAgents(
      [],
      {},
      undefined,
      TEST_DEFAULT_MODEL,
      undefined,
      undefined,
      [],
      customAgentSummaries,
    )

    expect(agents.sisyphus.prompt).toContain("researcher")
  })
})

describe("createBuiltinAgents deadlock prevention", () => {
  test("calls fetchAvailableModels with undefined client", async () => {
    const fetchSpy = spyOn(modelAvailability, "fetchAvailableModels").mockResolvedValue(new Set<string>())

    const mockClient = {
      provider: { list: () => Promise.resolve({ data: { connected: [] } }) },
      model: { list: () => Promise.resolve({ data: [] }) },
    }

    await createBuiltinAgents([], {}, undefined, TEST_DEFAULT_MODEL, undefined, undefined, [], mockClient)

    expect(fetchSpy).toHaveBeenCalled()
    const firstCallArgs = fetchSpy.mock.calls[0]
    expect(firstCallArgs[0]).toBeUndefined()

    fetchSpy.mockRestore()
  })
})
