export type ForbiddenOperationCounts = Readonly<{
  readonly canonical_export: number
  readonly authority_refinement: number
  readonly continuation_schedule: number
  readonly artifact_patch: number
  readonly artifact_merge: number
}>

export type ForbiddenOperationSeams = Readonly<{
  readonly write_canonical_export: () => void
  readonly refine_canonical_authority: () => void
  readonly schedule_research_continuation: () => void
  readonly patch_research_artifact: () => void
  readonly merge_parent_artifacts: () => void
}>

export function createForbiddenOperationProbe(): Readonly<{
  readonly seams: ForbiddenOperationSeams
  readonly counts: () => ForbiddenOperationCounts
}> {
  const calls = [0, 0, 0, 0, 0]
  return {
    seams: {
      write_canonical_export: () => { calls[0] += 1 },
      refine_canonical_authority: () => { calls[1] += 1 },
      schedule_research_continuation: () => { calls[2] += 1 },
      patch_research_artifact: () => { calls[3] += 1 },
      merge_parent_artifacts: () => { calls[4] += 1 },
    },
    counts: () => ({
      canonical_export: calls[0] ?? 0,
      authority_refinement: calls[1] ?? 0,
      continuation_schedule: calls[2] ?? 0,
      artifact_patch: calls[3] ?? 0,
      artifact_merge: calls[4] ?? 0,
    }),
  }
}
