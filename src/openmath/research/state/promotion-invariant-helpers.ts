import type { z } from "zod"

import type { CandidateArtifactReference } from "./candidates"

export function parsePromotionJson(serialized: string): unknown {
  try {
    return JSON.parse(serialized)
  } catch (error) {
    if (error instanceof SyntaxError) return null
    throw error
  }
}

export function samePromotionArtifact(
  left: CandidateArtifactReference,
  right: CandidateArtifactReference,
): boolean {
  return left.child_run_id === right.child_run_id
    && left.child_state_revision === right.child_state_revision
    && left.artifact_version === right.artifact_version
    && left.media_type === right.media_type
    && left.sha256 === right.sha256
}

export function addPromotionIssue(
  context: z.RefinementCtx,
  path: readonly (string | number)[],
  message: string,
): void {
  context.addIssue({ code: "custom", path: [...path], message })
}
