import { ProblemRefNotFoundError } from "../openmath-solve-only/problem-ref"
import { ReplacementPromptDiagnostic } from "../../agents/builtin-agents/replacement-prompt-resolver"
import { ReferenceManifestError } from "../../openmath/references/types"
import { WorkflowProfileResolutionError } from "../../openmath/workflow"
import { StagePersistenceError } from "../../openmath/workflow/stage-runner/stage-persistence-error"
import { WorkflowErrorCodeSchema } from "../../openmath/workflow/state/literals"
import { jsonWorkflowError } from "./envelope"
import { ZodError } from "zod"

export function jsonWorkflowException(error: unknown): string {
  if (error instanceof ZodError) return jsonWorkflowError({ error_code: "VALIDATION_ERROR", message: error.message })
  if (error instanceof ProblemRefNotFoundError) return jsonWorkflowError({ error_code: "VALIDATION_ERROR", message: error.message })
  if (error instanceof ReplacementPromptDiagnostic) return jsonWorkflowError({ error_code: "PROMPT_SOURCE_ERROR", message: error.message })
  if (error instanceof ReferenceManifestError) return jsonWorkflowError({ error_code: "REFERENCE_SOURCE_ERROR", message: error.message })
  if (error instanceof WorkflowProfileResolutionError) {
    return jsonWorkflowError({ error_code: error.code === "profile_not_found" ? "PROFILE_NOT_FOUND" : "PROMPT_SOURCE_ERROR", message: error.message })
  }
  if (error instanceof StagePersistenceError) {
    const code = WorkflowErrorCodeSchema.safeParse(error.error_code)
    return jsonWorkflowError({ error_code: code.success ? code.data : "SUBAGENT_FAILED", message: error.message })
  }
  if (error instanceof Error) return jsonWorkflowError({ error_code: "SUBAGENT_FAILED", message: error.message })
  return jsonWorkflowError({ error_code: "SUBAGENT_FAILED", message: "Workflow operation failed" })
}
