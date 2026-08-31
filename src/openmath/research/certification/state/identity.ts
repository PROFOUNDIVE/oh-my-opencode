import { z } from "zod"

import { sha256 } from "../../../workflow/stage-runner/sha256"
import { CampaignIdSchema, CampaignRevisionSchema, CandidateIdSchema, ChildRunIdSchema } from "../../state/literals"
import {
  CertificationGenerationIdSchema,
  CertificationIdSchema,
  CertificationSha256Schema,
} from "./literals"

export const CertificationSelectedArtifactSchema = z.object({
  candidate_id: CandidateIdSchema,
  child_run_id: ChildRunIdSchema,
  child_state_revision: CampaignRevisionSchema,
  artifact_version: z.number().int().positive(),
  media_type: z.enum(["text/markdown", "application/vnd.openmath.legacy+json"]),
  artifact_sha256: CertificationSha256Schema,
}).strict().readonly()

const CertificationIdentityInputSchema = z.object({
  campaign_id: CampaignIdSchema,
  selected_artifact_sha256: CertificationSha256Schema,
  certification_profile_sha256: CertificationSha256Schema,
}).strict().readonly()

export const CertificationGenerationIndexV1Schema = z.object({
  schema_version: z.literal(1),
  campaign_id: CampaignIdSchema,
  certification_id: CertificationIdSchema,
  generation_id: CertificationGenerationIdSchema,
  selected_artifact: CertificationSelectedArtifactSchema,
  certification_profile_sha256: CertificationSha256Schema,
  initialized_from_campaign_revision: CampaignRevisionSchema,
}).strict().superRefine((index, context) => {
  const expected = deriveCertificationIdentity({
    campaign_id: index.campaign_id,
    selected_artifact_sha256: index.selected_artifact.artifact_sha256,
    certification_profile_sha256: index.certification_profile_sha256,
  })
  if (index.certification_id !== expected.certification_id) {
    context.addIssue({ code: "custom", path: ["certification_id"], message: "Certification ID must bind generation identity" })
  }
  if (index.generation_id !== expected.generation_id) {
    context.addIssue({ code: "custom", path: ["generation_id"], message: "Generation ID must bind campaign, artifact, and profile" })
  }
}).readonly()

export function deriveCertificationIdentity(input: z.input<typeof CertificationIdentityInputSchema>) {
  const parsed = CertificationIdentityInputSchema.parse(input)
  const digest = sha256(`${parsed.campaign_id}\n${parsed.selected_artifact_sha256}\n${parsed.certification_profile_sha256}`)
  return {
    certification_id: CertificationIdSchema.parse(`certification-${digest.slice(0, 32)}`),
    generation_id: CertificationGenerationIdSchema.parse(digest),
  } as const
}

export type CertificationSelectedArtifact = z.infer<typeof CertificationSelectedArtifactSchema>
export type CertificationGenerationIndexV1 = z.infer<typeof CertificationGenerationIndexV1Schema>
