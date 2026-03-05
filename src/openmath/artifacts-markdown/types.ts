export type OpenMathArtifactsSectionId =
  | "reference_solution"
  | "hint_ladder"
  | "grading_rubric"
  | "variant_problem"

export type OpenMathReferenceSolutionSentinel = "@REFERENCE_SOLUTION"

export interface OpenMathHintLadderDraft {
  L1_nudge: string
  L2_key_theorem: string
  L3_skeleton: string[]
  L4_full_solution: string | OpenMathReferenceSolutionSentinel
}

export interface OpenMathGradingRubricDraft {
  premises_check: string[]
  logical_steps: string[]
  common_pitfalls: string[]
  key_theorem: string
  key_technique: string
}

export interface OpenMathArtifactsDraft {
  reference_solution: string
  hint_ladder: OpenMathHintLadderDraft
  grading_rubric: OpenMathGradingRubricDraft
  variant_problem: string
}

export type OpenMathArtifactsParseErrorCode =
  | "INVALID_MARKER"
  | "UNEXPECTED_TEXT_OUTSIDE_SECTIONS"
  | "NESTED_SECTION"
  | "ENDSECTION_WITHOUT_SECTION"
  | "UNCLOSED_SECTION"
  | "UNKNOWN_SECTION_ID"
  | "DUPLICATE_SECTION"
  | "MISSING_SECTION"
  | "INVALID_SECTION_CONTENT"

export interface OpenMathArtifactsParseError {
  code: OpenMathArtifactsParseErrorCode
  message: string
  line?: number
  section?: OpenMathArtifactsSectionId
}
