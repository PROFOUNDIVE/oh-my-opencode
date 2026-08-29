import { getWorkflowStatus } from "../../workflow/application/get-workflow-status"
import { stepResearchCampaign } from "../application"
import { createSelectedRefinementStepDependencies } from "../refinement"
import {
  createKeepSelection,
  FakeRefinementTransport,
  reviewOutput,
} from "../refinement/refinement-test-support"
import { readResearchCampaignState } from "../storage"

export async function createPassedCampaign(directory: string) {
  const selected = await createKeepSelection(directory)
  const transport = new FakeRefinementTransport([reviewOutput("[CORRECT]")])
  const refined = await stepResearchCampaign({
    directory,
    campaign_id: "campaign-a",
    expected_state_revision: selected.state_revision,
    mode: "one_stage",
  }, createSelectedRefinementStepDependencies({
    directory,
    create_job_runtime: (callbacks) => transport.runtime(callbacks),
  }))
  if (!refined.ok) throw new TypeError(refined.message)
  const campaign = await readResearchCampaignState(directory, "campaign-a")
  if (campaign.kind !== "ok") throw new TypeError(campaign.message)
  const selectedCandidate = campaign.state.candidates.find((candidate) => (
    candidate.candidate_id === campaign.state.selected_candidate_id
  ))
  if (selectedCandidate === undefined) throw new TypeError("Selected candidate is unavailable")
  const child = await getWorkflowStatus({ directory, run_id: selectedCandidate.child_run_id })
  if (child.kind !== "ok") throw new TypeError(child.message)
  return { campaign: campaign.state, child: child.state }
}
