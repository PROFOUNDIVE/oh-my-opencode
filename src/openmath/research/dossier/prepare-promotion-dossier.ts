import { getWorkflowStatus } from "../../workflow/application/get-workflow-status"
import { readResearchCampaignState } from "../storage"
import { reduceCampaignTransition } from "../transitions"
import type { CampaignStateResult } from "../application/campaign-application-result"
import type { CampaignMutationDependencies } from "../application/campaign-mutation-dependencies"
import { staleCampaignRevision, writeCampaignTransition } from "../application/commit-campaign-transition"
import { parseFrozenCandidateSources } from "../candidates/frozen-candidate-sources"
import { buildPromotionDossier } from "./build-promotion-dossier"
import { buildPromotionDossierV2 } from "./build-promotion-dossier-v2"
import { readPromotionCertificationEvidence } from "./read-promotion-certification-evidence"

export type PreparePromotionDossierDependencies = CampaignMutationDependencies & Readonly<{
  readonly read_child_state?: typeof getWorkflowStatus
  readonly read_certification_evidence?: typeof readPromotionCertificationEvidence
}>

export async function preparePromotionDossier(input: Readonly<{
  readonly directory: string
  readonly campaign_id: string
  readonly expected_state_revision: number
}>, dependencies: PreparePromotionDossierDependencies = {}): Promise<CampaignStateResult> {
  const current = await (dependencies.read_state ?? readResearchCampaignState)(input.directory, input.campaign_id)
  if (current.kind === "error") return current
  if (current.state.state_revision !== input.expected_state_revision) {
    return staleCampaignRevision(input.expected_state_revision, current.state.state_revision)
  }
  const selected = current.state.candidates.find((candidate) => candidate.candidate_id === current.state.selected_candidate_id)
  if (selected === undefined) return invalid("Promotion dossier requires one selected candidate")
  const child = await (dependencies.read_child_state ?? getWorkflowStatus)({
    directory: input.directory,
    run_id: selected.child_run_id,
  })
  if (child.kind !== "ok") return invalid(child.message)
  const frozen = parseFrozenCandidateSources(current.state)
  if (!frozen.ok) return invalid(frozen.message)
  const built = frozen.sources.profile.certification === undefined
    ? buildPromotionDossier({ campaign: current.state, child: child.state })
    : await buildV2({ request: input, campaign: current.state, child: child.state, dependencies })
  if (!built.ok) return invalid(built.message)
  const transition = reduceCampaignTransition(current.state, { type: "DOSSIER_READY", dossier: built.reference })
  if (!transition.ok) return invalid(transition.message)
  return writeCampaignTransition(input, transition.state, dependencies)
}

async function buildV2(
  input: Readonly<{
    readonly request: Readonly<{ readonly directory: string; readonly campaign_id: string; readonly expected_state_revision: number }>
    readonly campaign: Parameters<typeof buildPromotionDossierV2>[0]["campaign"]
    readonly child: Parameters<typeof buildPromotionDossierV2>[0]["child"]
    readonly dependencies: PreparePromotionDossierDependencies
  }>,
) {
  const evidence = await (input.dependencies.read_certification_evidence ?? readPromotionCertificationEvidence)(input.request)
  return evidence.kind === "ok"
    ? buildPromotionDossierV2({
        campaign: input.campaign,
        child: input.child,
        certification: evidence.state,
        certification_content_sha256: evidence.content_sha256,
      })
    : { ok: false as const, message: evidence.message }
}

function invalid(message: string): Extract<CampaignStateResult, { readonly kind: "error" }> {
  return { kind: "error", error_code: "VALIDATION_ERROR", message }
}
