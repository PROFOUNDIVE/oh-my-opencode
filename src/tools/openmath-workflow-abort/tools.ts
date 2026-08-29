import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool"

import { abortWorkflow } from "../../openmath/workflow/application/abort-workflow"
import { jsonWorkflowError, jsonWorkflowException, jsonWorkflowSuccess, type OpenMathWorkflowToolOptions } from "../openmath-workflow-shared"
import { OpenMathWorkflowAbortInputSchema } from "./types"

export function createOpenMathWorkflowAbortTool(options: OpenMathWorkflowToolOptions): ToolDefinition {
  return tool({
    description: "Revision-check and abort an OpenMath workflow run.",
    args: OpenMathWorkflowAbortInputSchema.shape,
    execute: async (rawArgs: Record<string, unknown>) => {
      try {
        const input = OpenMathWorkflowAbortInputSchema.parse(rawArgs)
        const result = await abortWorkflow({
          directory: options.directory,
          run_id: input.run_id,
          expected_state_revision: input.expected_state_revision,
          reason: input.reason,
        })
        return result.kind === "ok" ? jsonWorkflowSuccess(result.state) : jsonWorkflowError(result)
      } catch (error) {
        return jsonWorkflowException(error)
      }
    },
  })
}
