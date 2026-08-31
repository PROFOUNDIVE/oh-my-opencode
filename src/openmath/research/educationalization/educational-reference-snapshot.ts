import { calculateReferenceBundleSha256 } from "../../references/renderer"
import { ReferenceSnapshotSchema, type WorkflowStateV1 } from "../../workflow/state"

export function createEducationalReferenceSnapshot(
  referenceSolution: string,
  referenceSolutionSha256: string,
): WorkflowStateV1["reference_snapshot"] {
  const references = [{
    id: "approved-research-reference-solution",
    role: "authoritative" as const,
    stages: ["solve", "review", "revise"] as const,
    required: true,
    content: referenceSolution,
    sha256: referenceSolutionSha256,
    source: { kind: "inline" as const, path: "inline:approved-research-reference-solution" },
  }]
  return ReferenceSnapshotSchema.parse({
    version: 1,
    manifest: { kind: "legacy_supplementary" },
    references,
    diagnostics: [],
    sha256: calculateReferenceBundleSha256(references),
  })
}
