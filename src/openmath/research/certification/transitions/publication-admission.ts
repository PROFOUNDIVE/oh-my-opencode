import { hashResearchCertificationState, type ResearchCertificationStateV1 } from "../state/schema"
import { evaluateCertificationEligibility } from "./eligibility"
import type { CertificationProfileLimits } from "./types"

type PublicationAdmissionInput = Readonly<{
  readonly campaign_phase: "PROMOTION"
  readonly campaign_status: "READY" | "ABORTED"
  readonly current_state_revision: number
  readonly expected_state_revision: number
  readonly state: ResearchCertificationStateV1
  readonly expected_certification_revision: number
  readonly observed_selected_artifact: ResearchCertificationStateV1["selected_artifact"]
  readonly expected_certification_profile_sha256: string
  readonly computed_sidecar_sha256: string
  readonly attachment_content_sha256: string
  readonly persisted_dossier_sha256: string
  readonly computed_dossier_sha256: string
  readonly dossier_attachment_sha256: string
  readonly profile: CertificationProfileLimits
}>

export type PublicationAdmissionResult =
  | Readonly<{ readonly ok: true }>
  | Readonly<{ readonly ok: false; readonly error_code:
      | "CAMPAIGN_ABORTED"
      | "STALE_STATE_REVISION"
      | "STALE_CERTIFICATION_REVISION"
      | "STALE_ARTIFACT"
      | "PROFILE_HASH_MISMATCH"
      | "CERTIFICATION_INCOMPLETE"
      | "APPROVAL_INELIGIBLE"
      | "ATTACHMENT_HASH_MISMATCH"
      | "DOSSIER_HASH_MISMATCH"
    }>

export function admitCertificationPublication(input: PublicationAdmissionInput): PublicationAdmissionResult {
  if (input.campaign_status === "ABORTED") return failure("CAMPAIGN_ABORTED")
  if (input.current_state_revision !== input.expected_state_revision) return failure("STALE_STATE_REVISION")
  if (input.state.certification_revision !== input.expected_certification_revision) return failure("STALE_CERTIFICATION_REVISION")
  if (JSON.stringify(input.state.selected_artifact) !== JSON.stringify(input.observed_selected_artifact)) return failure("STALE_ARTIFACT")
  if (input.state.certification_profile_sha256 !== input.expected_certification_profile_sha256
    || input.profile.certification_profile_sha256 !== input.expected_certification_profile_sha256) return failure("PROFILE_HASH_MISMATCH")
  if (input.state.status !== "COMPLETE") return failure("CERTIFICATION_INCOMPLETE")
  const eligibility = evaluateCertificationEligibility({ state: input.state, profile: input.profile })
  if (!eligibility.completion_eligible) return failure("CERTIFICATION_INCOMPLETE")
  if (!eligibility.approval_eligible) return failure("APPROVAL_INELIGIBLE")
  const exactStateHash = hashResearchCertificationState(input.state)
  if (input.computed_sidecar_sha256 !== exactStateHash
    || input.attachment_content_sha256 !== exactStateHash
    || input.dossier_attachment_sha256 !== exactStateHash) return failure("ATTACHMENT_HASH_MISMATCH")
  if (input.persisted_dossier_sha256 !== input.computed_dossier_sha256) return failure("DOSSIER_HASH_MISMATCH")
  return { ok: true }
}

function failure(errorCode: Exclude<PublicationAdmissionResult, { readonly ok: true }>["error_code"]): PublicationAdmissionResult {
  return { ok: false, error_code: errorCode }
}
