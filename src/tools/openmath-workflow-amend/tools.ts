import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool"

import { amendWorkflow } from "../../openmath/workflow/application/amend-workflow"
import { jsonWorkflowError, jsonWorkflowException, jsonWorkflowSuccess, type OpenMathWorkflowToolOptions } from "../openmath-workflow-shared"
import { OpenMathWorkflowAmendInputSchema, OpenMathWorkflowAmendmentScopeSchema, OpenMathWorkflowNonBlankSchema } from "./types"

export function createOpenMathWorkflowAmendTool(options: OpenMathWorkflowToolOptions): ToolDefinition {
  return tool({
    description: "Append or retract a revision-checked OpenMath workflow amendment.",
    args: {
      run_id: OpenMathWorkflowNonBlankSchema,
      expected_state_revision: tool.schema.number().int().nonnegative(),
      operation: tool.schema.enum(["add", "retract"]),
      kind: tool.schema.enum(["question", "required_check", "suspected_blocker", "scope_change"]).optional(),
      scope: OpenMathWorkflowAmendmentScopeSchema.optional(),
      content: OpenMathWorkflowNonBlankSchema.optional(),
      amendment_id: OpenMathWorkflowNonBlankSchema.optional(),
    },
    execute: async (rawArgs: Record<string, unknown>) => {
      try {
        const input = OpenMathWorkflowAmendInputSchema.parse(rawArgs)
        const result = await amendWorkflow({ ...input, directory: options.directory })
        return result.kind === "ok" ? jsonWorkflowSuccess(result.state) : jsonWorkflowError(result)
      } catch (error) {
        return jsonWorkflowException(error)
      }
    },
  })
}
