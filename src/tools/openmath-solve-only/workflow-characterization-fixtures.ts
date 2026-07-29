import { formatOpenMathArtifactsMarkdown } from "../../openmath/artifacts-markdown/format"

export const CHARACTERIZATION_REFS = ["reference-a", "reference-b"] as const

export type DispatchedSubagentCall = {
  readonly agentToUse: string
  readonly description: string
  readonly prompt: string
}

export type SubagentResult =
  | { readonly ok: true; readonly sessionID: string; readonly text: string }
  | { readonly ok: false; readonly error: string; readonly error_code?: string }

export function createCharacterizationArtifacts(): string {
  return formatOpenMathArtifactsMarkdown({
    reference_solution: "The characterized solution.",
    hint_ladder: {
      L1_nudge: "Start with the definition.",
      L2_key_theorem: "Apply the key theorem.",
      L3_skeleton: ["State the premise", "Conclude the result"],
      L4_full_solution: "@REFERENCE_SOLUTION",
    },
    grading_rubric: {
      premises_check: ["Premise stated"],
      logical_steps: ["Valid implication"],
      common_pitfalls: ["Missing premise"],
      key_theorem: "Characterization theorem",
      key_technique: "Direct proof",
    },
    variant_problem: "Prove the companion statement.",
  })
}

export function parseDispatchedPayload(prompt: string): Record<string, unknown> {
  const payload: unknown = JSON.parse(prompt)
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new TypeError("Expected a dispatched JSON object")
  }
  return { ...payload }
}

export function createReviewResult(payload: Record<string, unknown>, verdict: "[CORRECT]" | "[ERROR]"): string {
  return JSON.stringify({
    verdict,
    blocking_issues:
      verdict === "[ERROR]"
        ? [{ location: "reference_solution", type: "logic_error", fix_direction: "Revise it", evidence: "Gap" }]
        : [],
    checks_performed: ["logic"],
    certificate: {
      artifact_version: "v1",
      review_round: payload.review_round,
      timestamp: "1970-01-01T00:00:00.000Z",
    },
    base_hash: payload.base_hash,
  })
}
