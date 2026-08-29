import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool"

import { stepWorkflow } from "../../openmath/workflow/application/step-workflow"
import { createWorkflowStageRuntime } from "../../openmath/workflow/stage-runner"
import type { ToolContextWithMetadata } from "../delegate-task/types"
import { jsonWorkflowError, jsonWorkflowException, jsonWorkflowSuccess, type OpenMathWorkflowToolOptions } from "../openmath-workflow-shared"
import { OpenMathWorkflowStepInputSchema } from "./types"

export function createOpenMathWorkflowStepTool(options: OpenMathWorkflowToolOptions): ToolDefinition {
  return tool({
    description: "Execute one persisted OpenMath workflow stage or continue to its checkpoint.",
    args: OpenMathWorkflowStepInputSchema.shape,
    execute: async (rawArgs: Record<string, unknown>, context) => {
      try {
        const input = OpenMathWorkflowStepInputSchema.parse(rawArgs)
        const ctx = context as ToolContextWithMetadata
        const result = await stepWorkflow({
          directory: options.directory,
          run_id: input.run_id,
          expected_state_revision: input.expected_state_revision,
          mode: input.mode ?? "one_stage",
        }, { create_runtime: (state) => options.createStageRuntime?.({ state, ctx }) ?? defaultRuntime(options, state, ctx) })
        return result.kind === "ok" ? jsonWorkflowSuccess(result.state) : jsonWorkflowError(result)
      } catch (error) {
        return jsonWorkflowException(error)
      }
    },
  })
}

function defaultRuntime(
  options: OpenMathWorkflowToolOptions,
  state: Parameters<typeof createWorkflowStageRuntime>[0]["state"],
  ctx: ToolContextWithMetadata,
) {
  if (!options.client) return undefined
  return createWorkflowStageRuntime({ state, directory: options.directory, client: options.client, ctx })
}
