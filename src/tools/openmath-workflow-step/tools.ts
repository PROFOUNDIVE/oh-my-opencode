import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool"

import { createWorkflowStageRuntime, runWorkflowStep } from "../../openmath/workflow/stage-runner"
import { readWorkflowState } from "../../openmath/workflow/storage"
import { reduceTransition } from "../../openmath/workflow/transitions"
import type { ToolContextWithMetadata } from "../delegate-task/types"
import { jsonWorkflowError, jsonWorkflowException, jsonWorkflowSuccess, workflowInputFromSnapshot, type OpenMathWorkflowToolOptions } from "../openmath-workflow-shared"
import { OpenMathWorkflowStepInputSchema } from "./types"

export function createOpenMathWorkflowStepTool(options: OpenMathWorkflowToolOptions): ToolDefinition {
  return tool({
    description: "Execute one persisted OpenMath workflow stage or continue to its checkpoint.",
    args: OpenMathWorkflowStepInputSchema.shape,
    execute: async (rawArgs: Record<string, unknown>, context) => {
      try {
        const input = OpenMathWorkflowStepInputSchema.parse(rawArgs)
        const current = await readWorkflowState(options.directory, input.run_id)
        if (current.kind === "error") return jsonWorkflowError(current)
        if (current.state.state_revision !== input.expected_state_revision) {
          return jsonWorkflowError({ error_code: "STALE_STATE_REVISION", message: `Expected revision ${input.expected_state_revision}, found ${current.state.state_revision}`, current_state_revision: current.state.state_revision })
        }
        if (current.state.request_snapshot === undefined) {
          return jsonWorkflowError({ error_code: "STORAGE_READ_FAILED", message: "Workflow request snapshot is missing" })
        }
        const preflight = reduceTransition(current.state, { type: "STEP", mode: input.mode ?? "one_stage" })
        if (!preflight.ok) return jsonWorkflowError({ error_code: preflight.error_code, message: preflight.message })
        const ctx = context as ToolContextWithMetadata
        const runtime = options.createStageRuntime?.({ state: current.state, ctx }) ?? defaultRuntime(options, current.state, ctx)
        if (!runtime) return jsonWorkflowError({ error_code: "SUBAGENT_FAILED", message: "OpenCode client is required to execute workflow stages" })
        const state = await runWorkflowStep({
          state: current.state,
          workflow_input: workflowInputFromSnapshot(current.state.request_snapshot),
          mode: input.mode ?? "one_stage",
          runtime,
        })
        return jsonWorkflowSuccess(state)
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
