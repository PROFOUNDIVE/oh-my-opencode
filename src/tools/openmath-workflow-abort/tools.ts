import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool"

import { jsonWorkflowException, mutateWorkflow, type OpenMathWorkflowToolOptions } from "../openmath-workflow-shared"
import { OpenMathWorkflowAbortInputSchema } from "./types"

export function createOpenMathWorkflowAbortTool(options: OpenMathWorkflowToolOptions): ToolDefinition {
  return tool({
    description: "Revision-check and abort an OpenMath workflow run.",
    args: OpenMathWorkflowAbortInputSchema.shape,
    execute: async (rawArgs: Record<string, unknown>) => {
      try {
        const input = OpenMathWorkflowAbortInputSchema.parse(rawArgs)
        return await mutateWorkflow({
          directory: options.directory,
          run_id: input.run_id,
          expected_state_revision: input.expected_state_revision,
          event: { type: "ABORT", reason: input.reason },
        })
      } catch (error) {
        return jsonWorkflowException(error)
      }
    },
  })
}
