import { findBuiltinWorkflowProfile, legacyWorkflowProfileName } from "../../openmath/workflow"
import type { WorkflowRoleSettings } from "../../openmath/workflow"
import { WorkflowProfileSnapshotSchema, type WorkflowStateV1 } from "../../openmath/workflow/state"

export function createLegacyWorkflowProfileSnapshot(
  format: "markdown" | "json",
  maxReviewRounds: number,
): WorkflowStateV1["profile_snapshot"] {
  const name = legacyWorkflowProfileName(format)
  const profile = findBuiltinWorkflowProfile(name, maxReviewRounds)
  if (profile === undefined) throw new TypeError(`Missing built-in workflow profile: ${name}`)
  return WorkflowProfileSnapshotSchema.parse({
    snapshot_version: 1,
    name,
    solve: roleSnapshot(profile.solve),
    review: roleSnapshot(profile.review),
    revise: roleSnapshot(profile.revise),
    min_review_rounds: profile.min_review_rounds,
    max_review_rounds: profile.max_review_rounds,
    required_consecutive_passes: profile.required_consecutive_passes,
    checkpoint: profile.checkpoint,
  })
}

function roleSnapshot(role: WorkflowRoleSettings) {
  return {
    agent: role.agent,
    model: { providerID: "legacy", modelID: role.agent },
    prompt: { kind: "builtin" as const },
    output_adapter: role.output_adapter,
  }
}
