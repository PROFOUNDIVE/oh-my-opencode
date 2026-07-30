import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool"

import { jsonWorkflowException, mutateWorkflow, type OpenMathWorkflowToolOptions } from "../openmath-workflow-shared"
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
        const event = input.operation === "add"
          ? { type: "ADD_AMENDMENT" as const, kind: input.kind, scope: input.scope, content: input.content }
          : { type: "RETRACT_AMENDMENT" as const, amendment_id: input.amendment_id }
        return await mutateWorkflow({ ...input, directory: options.directory, event })
      } catch (error) {
        return jsonWorkflowException(error)
      }
    },
  })
}
