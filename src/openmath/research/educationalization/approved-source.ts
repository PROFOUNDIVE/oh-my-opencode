import { loadCertificationContext } from "../certification/application/load-certification-context"
import { hashCertificationSummary } from "../certification/state/summary"
import { PromotionDossierV2Schema } from "../dossier/promotion-dossier-v2-schema"
import { readPromotionCertificationEvidence } from "../dossier/read-promotion-certification-evidence"
import { readResearchCampaignState } from "../storage"
import { sha256 } from "../../workflow/stage-runner/sha256"
import type { WorkflowRequestSnapshot } from "../../workflow/state"

type ResearchEducationalizationRequest = Extract<WorkflowRequestSnapshot, { readonly kind: "research_educationalization" }>

export type ApprovedEducationalSource = Omit<ResearchEducationalizationRequest, "kind">

export type ApprovedEducationalSourceResult =
  | Readonly<{ readonly ok: true; readonly source: ApprovedEducationalSource }>
  | Readonly<{
      readonly ok: false
      readonly error_code: "CAMPAIGN_NOT_APPROVED" | "STALE_STATE_REVISION" | "DOSSIER_HASH_MISMATCH"
        | "CERTIFICATION_SOURCE_MISMATCH" | "SELECTED_ARTIFACT_MISMATCH" | "STORAGE_READ_FAILED"
      readonly message: string
    }>

export async function validateApprovedEducationalSource(input: Readonly<{
  readonly directory: string
  readonly campaign_id: string
  readonly expected_state_revision: number
  readonly expected_certification_revision: number
  readonly dossier_sha256: string
}>): Promise<ApprovedEducationalSourceResult> {
  const campaignRead = await readResearchCampaignState(input.directory, input.campaign_id)
  if (campaignRead.kind === "error") return failure("STORAGE_READ_FAILED", campaignRead.message)
  const campaign = campaignRead.state
  if (campaign.status !== "PROMOTION_READY") {
    return failure("CAMPAIGN_NOT_APPROVED", "Research campaign must be explicitly approved before educationalization")
  }
  if (campaign.state_revision !== input.expected_state_revision) {
    return failure("STALE_STATE_REVISION", `Expected revision ${input.expected_state_revision}, found ${campaign.state_revision}`)
  }
  const dossierReference = campaign.dossier
  if (dossierReference === null || dossierReference.content_sha256 !== input.dossier_sha256
    || sha256(dossierReference.serialized_bytes) !== input.dossier_sha256) {
    return failure("DOSSIER_HASH_MISMATCH", "Promotion dossier hash does not match the approved campaign")
  }
  const dossier = parseDossier(dossierReference.serialized_bytes)
  if (dossier === null || dossier.campaign_id !== campaign.campaign_id) {
    return failure("DOSSIER_HASH_MISMATCH", "Approved PromotionDossierV2 is unavailable or mismatched")
  }
  if (dossier.certification_summary.certification_revision !== input.expected_certification_revision) {
    return failure("CERTIFICATION_SOURCE_MISMATCH", "Certification revision does not match the approved dossier")
  }
  const loaded = await loadCertificationContext({ directory: input.directory, campaign_id: input.campaign_id })
  if (loaded.kind !== "ok") {
    return failure("SELECTED_ARTIFACT_MISMATCH", loaded.kind === "disabled" ? "Certification is not enabled" : loaded.message)
  }
  const evidence = await readPromotionCertificationEvidence({
    directory: input.directory,
    campaign_id: input.campaign_id,
    expected_state_revision: input.expected_state_revision,
  })
  if (evidence.kind === "error") return failure("CERTIFICATION_SOURCE_MISMATCH", evidence.message)
  const artifact = loaded.context.child.artifact
  if (artifact === null || artifact.sha256 !== dossier.selected_artifact.sha256
    || JSON.stringify(evidence.observed_selected_artifact) !== JSON.stringify(loaded.context.state_identity)) {
    return failure("SELECTED_ARTIFACT_MISMATCH", "Selected artifact identity or exact bytes are stale")
  }
  if (evidence.state.certification_revision !== input.expected_certification_revision
    || evidence.content_sha256 !== dossier.certification_attachment.content_sha256
    || JSON.stringify(evidence.state.summary) !== JSON.stringify(dossier.certification_summary)
    || evidence.state.summary === null) {
    return failure("CERTIFICATION_SOURCE_MISMATCH", "Certification evidence does not match the approved dossier")
  }
  const objective = loaded.context.sources.objective
  return {
    ok: true,
    source: {
      campaign_id: campaign.campaign_id,
      approved_campaign_revision: campaign.state_revision,
      dossier_id: dossier.dossier_id,
      dossier_sha256: input.dossier_sha256,
      selected_artifact: loaded.context.state_identity,
      certification: {
        certification_id: evidence.state.certification_id,
        generation_id: evidence.state.generation_id,
        certification_revision: evidence.state.certification_revision,
        content_sha256: evidence.content_sha256,
        summary_sha256: hashCertificationSummary(evidence.state.summary),
      },
      certification_summary_json: JSON.stringify(dossier.certification_summary),
      remaining_uncertainties_json: JSON.stringify(dossier.remaining_uncertainties),
      remaining_uncertainties_sha256: sha256(JSON.stringify(dossier.remaining_uncertainties)),
      reference_solution: artifact.content,
      reference_solution_sha256: artifact.sha256,
      ...(objective.kind === "problem" ? { original_problem_text: objective.problem_text } : {}),
    },
  }
}

function parseDossier(serializedBytes: string) {
  try {
    const result = PromotionDossierV2Schema.safeParse(JSON.parse(serializedBytes))
    return result.success ? result.data : null
  } catch (error) {
    if (error instanceof SyntaxError) return null
    throw error
  }
}

function failure(errorCode: Exclude<ApprovedEducationalSourceResult, { readonly ok: true }>["error_code"], message: string) {
  return { ok: false as const, error_code: errorCode, message }
}
