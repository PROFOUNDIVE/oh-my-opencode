import { sha256 } from "../../workflow/stage-runner/sha256"
import type { WorkflowStateV1 } from "../../workflow/state"
import type { CandidateArtifactReference } from "../state"

export function screenTargetMatchesReference(
  target: NonNullable<WorkflowStateV1["artifact"]>,
  reference: CandidateArtifactReference,
): boolean {
  return target.version === reference.artifact_version
    && target.media_type === reference.media_type
    && target.sha256 === reference.sha256
    && sha256(target.content) === reference.sha256
}
