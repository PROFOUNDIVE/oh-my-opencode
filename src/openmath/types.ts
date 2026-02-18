export type ArtifactState = "DRAFT" | "FROZEN" | "UNFROZEN"

export type ReviewVerdict = "[CORRECT]" | "[ERROR]" | "[INCONCLUSIVE]"

export interface ReviewCertificate {
  artifact_version: string
  review_round: number
  timestamp: string
  verdict: ReviewVerdict
  notes?: string
}

export interface FrozenArtifacts {
  reference_solution: string
  hint_ladder: Record<string, unknown>
  grading_rubric: Record<string, unknown>
  variant_problem: string
  review_certificate: ReviewCertificate
}

export interface HintBudgetState {
  hints_used: number
  hint_budget: number
}

export interface OpenMathSessionState {
  session_id: string
  artifact_state: ArtifactState
  artifact_version: number
  review_round: number
  max_review_rounds: number
  hint_budget_state: HintBudgetState
  frozen_artifacts: FrozenArtifacts | null
}

export type OpenMathTransitionEvent =
  | {
      type: "SOLVE_SUBMITTED"
    }
  | {
      type: "REVIEW_REPORTED"
      verdict: ReviewVerdict
      frozen_artifacts?: FrozenArtifacts
    }
  | {
      type: "POST_FREEZE_MUTATION"
      field: "reference_solution" | "hint_ladder" | "grading_rubric"
    }
  | {
      type: "COACH_HINT_CONSUMED"
    }

export interface OpenMathTransitionResult {
  state: OpenMathSessionState
  can_problem_specific_coaching: boolean
  can_verify_with_frozen_reference: boolean
}
