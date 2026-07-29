export type WorkflowProfileResolutionErrorCode =
  | "profile_not_found"
  | "missing_prompt_provenance"
  | "stale_prompt_provenance"
  | "invalid_explicit_model"

export class WorkflowProfileResolutionError extends Error {
  readonly name = "WorkflowProfileResolutionError"

  constructor(
    readonly code: WorkflowProfileResolutionErrorCode,
    readonly profile: string,
    readonly stage?: "solve" | "review" | "revise",
  ) {
    super(messageFor(code, profile, stage))
  }
}

function messageFor(
  code: WorkflowProfileResolutionErrorCode,
  profile: string,
  stage: "solve" | "review" | "revise" | undefined,
): string {
  switch (code) {
    case "profile_not_found":
      return `Workflow profile not found: ${profile}`
    case "missing_prompt_provenance":
      return `Workflow file prompt provenance is missing: ${profile}.${stage}`
    case "stale_prompt_provenance":
      return `Workflow file prompt provenance is stale: ${profile}.${stage}`
    case "invalid_explicit_model":
      return `Workflow explicit model is invalid: ${profile}.${stage}`
  }
}
