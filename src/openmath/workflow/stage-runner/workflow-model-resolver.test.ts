import { expect, test } from "bun:test"

import { resolveWorkflowRoleModels, WorkflowRoleModelResolutionError } from "./workflow-model-resolver"

test("resolves omitted role models once with plugin agent overrides while preserving explicit snapshots", async () => {
  // given
  const agents = { solver: { model: "openai/gpt-5.2", variant: "high" } }
  const resolvedAgents: string[] = []

  // when
  const models = await resolveWorkflowRoleModels({
    client: undefined,
    plugin_agents: agents,
    roles: {
      solve: { agent: "solver", model: "anthropic/claude", variant: "max" },
      review: { agent: "reviewer" },
      revise: { agent: "reviser" },
    },
  }, {
    resolveSubagent: async (_args, context) => {
      if (context.agentOverrides !== agents) throw new TypeError("Expected plugin agent overrides")
      resolvedAgents.push(_args.subagent_type ?? "")
      return { agentToUse: _args.subagent_type ?? "", categoryModel: { providerID: "openai", modelID: `${_args.subagent_type}-model`, variant: "medium" } }
    },
  })

  // then
  expect(models).toEqual({
    solve: { providerID: "anthropic", modelID: "claude", variant: "max" },
    review: { providerID: "openai", modelID: "reviewer-model", variant: "medium" },
    revise: { providerID: "openai", modelID: "reviser-model", variant: "medium" },
  })
  expect(resolvedAgents).toEqual(["reviewer", "reviser"])
})

test("rejects a blank resolved provider or model segment", async () => {
  // given
  const resolve = () => resolveWorkflowRoleModels({
    client: undefined,
    plugin_agents: undefined,
    roles: {
      solve: { agent: "solver" },
      review: { agent: "reviewer" },
      revise: { agent: "reviser" },
    },
  }, {
    resolveSubagent: async (args) => ({
      agentToUse: args.subagent_type ?? "",
      categoryModel: { providerID: "", modelID: "model" },
    }),
  })

  // when / then
  await expect(resolve()).rejects.toBeInstanceOf(WorkflowRoleModelResolutionError)
})

test("rejects a whitespace-only explicit variant before resolving another role", async () => {
  const resolve = () => resolveWorkflowRoleModels({
    client: undefined,
    plugin_agents: undefined,
    roles: {
      solve: { agent: "solver", model: "openai/gpt", variant: "   " },
      review: { agent: "reviewer" },
      revise: { agent: "reviser" },
    },
  }, { resolveSubagent: async () => { throw new Error("must not resolve") } })
  await expect(resolve()).rejects.toBeInstanceOf(WorkflowRoleModelResolutionError)
})
