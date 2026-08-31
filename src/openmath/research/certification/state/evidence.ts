import { z } from "zod"

import { sha256 } from "../../../workflow/stage-runner/sha256"
import { CampaignIdSchema } from "../../state/literals"
import { CertificationResolvedModelSchema } from "./model-provenance"
import {
  AttackAttemptIdSchema,
  CertificationGenerationIdSchema,
  CertificationIdSchema,
  CertificationJobIdSchema,
  CertificationRevisionSchema,
  CertificationSessionIdSchema,
  CertificationSha256Schema,
  CoverageReviewIdSchema,
  EvidenceReceiptIdSchema,
  WitnessVerificationIdSchema,
} from "./literals"

const EvidenceBaseSchema = z.object({
  schema_version: z.literal(1),
  evidence_id: EvidenceReceiptIdSchema,
  certification_id: CertificationIdSchema,
  generation_id: CertificationGenerationIdSchema,
  campaign_id: CampaignIdSchema,
  certification_revision: CertificationRevisionSchema,
  job_id: CertificationJobIdSchema,
  artifact_sha256: CertificationSha256Schema,
  graph_sha256: CertificationSha256Schema,
  prompt_sha256: CertificationSha256Schema,
  input_sha256: CertificationSha256Schema,
  output_sha256: CertificationSha256Schema,
  child_session_id: CertificationSessionIdSchema,
  resolved_model: CertificationResolvedModelSchema,
})

export const EvidenceReceiptV1Schema = z.discriminatedUnion("job_kind", [
  EvidenceBaseSchema.extend({
    evidence_type: z.literal("LLM_REVIEW"),
    job_kind: z.literal("EXTRACTION"),
    result_id: CertificationSha256Schema,
  }).strict(),
  EvidenceBaseSchema.extend({
    evidence_type: z.literal("LLM_REVIEW"),
    job_kind: z.literal("COVERAGE"),
    result_id: CoverageReviewIdSchema,
  }).strict(),
  EvidenceBaseSchema.extend({
    evidence_type: z.literal("LLM_COUNTERARGUMENT"),
    job_kind: z.literal("ATTACK"),
    result_id: AttackAttemptIdSchema,
  }).strict(),
  EvidenceBaseSchema.extend({
    evidence_type: z.literal("LLM_REVIEW"),
    job_kind: z.literal("WITNESS"),
    result_id: WitnessVerificationIdSchema,
  }).strict(),
]).readonly()

export function hashEvidenceReceipt(receipt: z.infer<typeof EvidenceReceiptV1Schema>): string {
  return sha256(JSON.stringify(receipt))
}

export type EvidenceReceiptV1 = z.infer<typeof EvidenceReceiptV1Schema>
