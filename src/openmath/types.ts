export type ArtifactState = "DRAFT" | "FROZEN" | "UNFROZEN"

export type ReviewVerdict = "[CORRECT]" | "[ERROR]" | "[INCONCLUSIVE]"

export interface ReviewCertificate {
  artifact_version: string
  review_round: number
  timestamp: string
  verdict: ReviewVerdict
  notes?: string
}

export interface ResearchPedagogicalReviewCertificate {
  certificate_kind: "research_pedagogical"
  artifact_version: string
  review_round: number
  verdict: "PEDAGOGICAL_PASS"
  review_report_sha256: string
  notes: string
  provenance: {
    campaign_id: string
    approved_campaign_revision: number
    dossier_id: string
    dossier_sha256: string
    candidate_id: string
    child_run_id: string
    child_state_revision: number
    source_artifact_version: number
    source_artifact_sha256: string
    certification_id: string
    certification_generation_id: string
    certification_revision: number
    certification_content_sha256: string
    certification_summary_sha256: string
    remaining_uncertainties_sha256: string
    reference_solution_sha256: string
  }
  claims: {
    canonical: false
    machine_checked: false
    mathematical_correctness_certified: false
  }
}

export interface FrozenArtifacts {
  reference_solution: string
  hint_ladder: Record<string, unknown>
  grading_rubric: Record<string, unknown>
  variant_problem: string
  review_certificate: ReviewCertificate | ResearchPedagogicalReviewCertificate
}

export interface HintBudgetState {
  hints_used: number
  hint_budget: number
}

export interface OpenMathSessionState {
  session_id: string
  original_problem_text?: string
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
