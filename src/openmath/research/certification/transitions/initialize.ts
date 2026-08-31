import type { z } from "zod"

import { deriveCertificationIdentity, type CertificationSelectedArtifactSchema } from "../state/identity"
import type { CertificationSha256Schema } from "../state/literals"
import { ResearchCertificationStateV1Schema, type ResearchCertificationStateV1 } from "../state/schema"

type InitializeCertificationInput = Readonly<{
  readonly campaign_id: string
  readonly selected_artifact: z.input<typeof CertificationSelectedArtifactSchema>
  readonly observed_selected_artifact: z.input<typeof CertificationSelectedArtifactSchema>
  readonly objective_sha256: z.input<typeof CertificationSha256Schema>
  readonly profile_sha256: z.input<typeof CertificationSha256Schema>
  readonly reference_sha256: z.input<typeof CertificationSha256Schema>
  readonly certification_profile_sha256: z.input<typeof CertificationSha256Schema>
}>

export type InitializeCertificationResult =
  | Readonly<{ readonly ok: true; readonly state: ResearchCertificationStateV1 }>
  | Readonly<{ readonly ok: false; readonly error_code: "STALE_ARTIFACT" | "VALIDATION_ERROR"; readonly message: string }>

export function initializeCertification(input: InitializeCertificationInput): InitializeCertificationResult {
  if (JSON.stringify(input.selected_artifact) !== JSON.stringify(input.observed_selected_artifact)) {
    return { ok: false, error_code: "STALE_ARTIFACT", message: "Selected artifact identity is stale" }
  }
  const identity = deriveCertificationIdentity({
    campaign_id: input.campaign_id,
    selected_artifact_sha256: input.selected_artifact.artifact_sha256,
    certification_profile_sha256: input.certification_profile_sha256,
  })
  const parsed = ResearchCertificationStateV1Schema.safeParse({
    schema_version: 1,
    ...identity,
    campaign_id: input.campaign_id,
    selected_artifact: input.selected_artifact,
    objective_sha256: input.objective_sha256,
    profile_sha256: input.profile_sha256,
    reference_sha256: input.reference_sha256,
    certification_profile_sha256: input.certification_profile_sha256,
    certification_revision: 0,
    phase: "EXTRACTION",
    status: "READY",
    awaiting_reason: null,
    abort_requested: false,
    abort_reason: null,
    blocked_reason: null,
    active_job_ids: [],
    graphs: [],
    coverage_reviews: [],
    attack_attempts: [],
    witness_verifications: [],
    evidence_receipts: [],
    amendments: [],
    job_attempts: [],
    summary: null,
    finalization: null,
  })
  return parsed.success
    ? { ok: true, state: parsed.data }
    : { ok: false, error_code: "VALIDATION_ERROR", message: "Certification identity is invalid" }
}
