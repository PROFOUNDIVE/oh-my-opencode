import { z } from "zod"

import { CampaignIdSchema, CampaignRevisionSchema } from "../../state/literals"
import { CertificationSelectedArtifactSchema } from "../state/identity"
import { CertificationSha256Schema } from "../state/literals"

export const CertificationStorageIdentitySchema = z.object({
  campaign_id: CampaignIdSchema,
  selected_artifact: CertificationSelectedArtifactSchema,
  certification_profile_sha256: CertificationSha256Schema,
  initialized_from_campaign_revision: CampaignRevisionSchema,
}).strict().readonly()

export type CertificationStorageIdentity = z.infer<typeof CertificationStorageIdentitySchema>
export type CertificationStorageIdentityInput = z.input<typeof CertificationStorageIdentitySchema>
