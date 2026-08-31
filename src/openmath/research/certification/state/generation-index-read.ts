import { z } from "zod"

import { CampaignIdSchema, CampaignRevisionSchema } from "../../state/literals"
import { CertificationGenerationIndexV1Schema, CertificationSelectedArtifactSchema } from "./identity"
import { CertificationSha256Schema } from "./literals"

export const CertificationGenerationIndexReadSchema = z.object({
  serialized_bytes: z.string().min(1),
  expected_campaign_id: CampaignIdSchema,
  expected_selected_artifact: CertificationSelectedArtifactSchema,
  expected_certification_profile_sha256: CertificationSha256Schema,
  expected_initialized_from_campaign_revision: CampaignRevisionSchema,
}).strict().superRefine((input, context) => {
  const parsedJson = parseJson(input.serialized_bytes)
  const parsed = CertificationGenerationIndexV1Schema.safeParse(parsedJson)
  if (!parsed.success) {
    context.addIssue({ code: "custom", path: ["serialized_bytes"], message: "Generation index bytes must contain strict V1 JSON" })
    return
  }
  const index = parsed.data
  if (JSON.stringify(index) !== input.serialized_bytes) context.addIssue({ code: "custom", path: ["serialized_bytes"], message: "Generation index bytes must use canonical JSON order" })
  if (index.campaign_id !== input.expected_campaign_id) context.addIssue({ code: "custom", path: ["expected_campaign_id"], message: "Generation index campaign identity mismatch" })
  if (JSON.stringify(index.selected_artifact) !== JSON.stringify(input.expected_selected_artifact)) context.addIssue({ code: "custom", path: ["expected_selected_artifact"], message: "Generation index artifact identity mismatch" })
  if (index.certification_profile_sha256 !== input.expected_certification_profile_sha256) context.addIssue({ code: "custom", path: ["expected_certification_profile_sha256"], message: "Generation index profile identity mismatch" })
  if (index.initialized_from_campaign_revision !== input.expected_initialized_from_campaign_revision) context.addIssue({ code: "custom", path: ["expected_initialized_from_campaign_revision"], message: "Generation index campaign revision mismatch" })
}).readonly()

function parseJson(serialized: string): unknown {
  try {
    return JSON.parse(serialized)
  } catch (error) {
    if (error instanceof SyntaxError) return null
    throw error
  }
}
