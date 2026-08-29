import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool"

import { getWorkflowStatus } from "../../openmath/workflow/application/get-workflow-status"
import { jsonWorkflowError, jsonWorkflowException, jsonWorkflowSuccess, type OpenMathWorkflowToolOptions } from "../openmath-workflow-shared"
import { OpenMathWorkflowStatusInputSchema } from "./types"

export function createOpenMathWorkflowStatusTool(options: OpenMathWorkflowToolOptions): ToolDefinition {
  return tool({
    description: "Read persisted OpenMath workflow status and its actionable next actions.",
    args: OpenMathWorkflowStatusInputSchema.shape,
    execute: async (rawArgs: Record<string, unknown>) => {
      try {
        const input = OpenMathWorkflowStatusInputSchema.parse(rawArgs)
        const result = await getWorkflowStatus({ directory: options.directory, run_id: input.run_id })
        return result.kind === "ok" ? jsonWorkflowSuccess(result.state) : jsonWorkflowError(result)
      } catch (error) {
        return jsonWorkflowException(error)
      }
    },
  })
}
