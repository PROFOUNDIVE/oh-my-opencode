import { createHash } from "node:crypto"

import type { ReferenceSnapshot } from "../../references/types"
import type { WorkflowRequestSnapshot } from "../../workflow/state"
import type { ResearchProfileSnapshot } from "../profile-snapshot"
import { ResearchCampaignSourceSnapshotSchema, type ResearchCampaignSourceSnapshot } from "../state"

export function buildCampaignSourceSnapshot(input: Readonly<{
  readonly objective: WorkflowRequestSnapshot
  readonly profile: ResearchProfileSnapshot
  readonly references: ReferenceSnapshot
}>): ResearchCampaignSourceSnapshot {
  const objectiveBytes = JSON.stringify(input.objective)
  const profileBytes = JSON.stringify(input.profile)
  const referenceBytes = JSON.stringify(input.references)
  return ResearchCampaignSourceSnapshotSchema.parse({
    objective: { request: input.objective, sha256: sha256(objectiveBytes) },
    profile: {
      schema_version: input.profile.snapshot_version,
      name: input.profile.name,
      serialized_bytes: profileBytes,
      sha256: sha256(profileBytes),
    },
    references: {
      schema_version: input.references.version,
      serialized_bytes: referenceBytes,
      sha256: sha256(referenceBytes),
    },
  })
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex")
}
