import { getWorkflowStatus } from "../../workflow/application/get-workflow-status"
import { readResearchCampaignState } from "../storage"
import { reduceCampaignTransition } from "../transitions"
import type { CampaignStateResult } from "../application/campaign-application-result"
import type { CampaignMutationDependencies } from "../application/campaign-mutation-dependencies"
import { staleCampaignRevision, writeCampaignTransition } from "../application/commit-campaign-transition"
import { buildPromotionDossier } from "./build-promotion-dossier"

export type PreparePromotionDossierDependencies = CampaignMutationDependencies & Readonly<{
  readonly read_child_state?: typeof getWorkflowStatus
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
  const built = buildPromotionDossier({ campaign: current.state, child: child.state })
  if (!built.ok) return invalid(built.message)
  const transition = reduceCampaignTransition(current.state, { type: "DOSSIER_READY", dossier: built.reference })
  if (!transition.ok) return invalid(transition.message)
  return writeCampaignTransition(input, transition.state, dependencies)
}

function invalid(message: string): Extract<CampaignStateResult, { readonly kind: "error" }> {
  return { kind: "error", error_code: "VALIDATION_ERROR", message }
}
