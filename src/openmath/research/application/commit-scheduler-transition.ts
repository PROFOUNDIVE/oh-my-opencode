import { readResearchCampaignState } from "../storage"
import { reduceCampaignTransition } from "../transitions"
import type { CampaignStateResult } from "./campaign-application-result"
import type { CampaignMutationDependencies } from "./campaign-mutation-dependencies"
import type { CampaignSchedulerTransition } from "./campaign-scheduler-contract"
import { writeCampaignTransition } from "./commit-campaign-transition"

export async function commitSchedulerTransition(input: Readonly<{
  readonly directory: string
  readonly campaign_id: string
  readonly event: CampaignSchedulerTransition
}>, dependencies: CampaignMutationDependencies): Promise<CampaignStateResult> {
  const current = await (dependencies.read_state ?? readResearchCampaignState)(input.directory, input.campaign_id)
  if (current.kind === "error") return current
  if (current.state.status === "ABORTED") return current
  const transition = reduceCampaignTransition(current.state, input.event)
  if (!transition.ok) {
    return { kind: "error", error_code: transition.error_code, message: transition.message }
  }
  const written = await writeCampaignTransition({
    directory: input.directory,
    campaign_id: input.campaign_id,
    expected_state_revision: current.state.state_revision,
  }, transition.state, dependencies)
  if (written.kind !== "error" || written.error_code !== "STALE_STATE_REVISION") return written
  return commitAfterConcurrentAbort(input, dependencies)
}

async function commitAfterConcurrentAbort(input: Readonly<{
  readonly directory: string
  readonly campaign_id: string
  readonly event: CampaignSchedulerTransition
}>, dependencies: CampaignMutationDependencies): Promise<CampaignStateResult> {
  const current = await (dependencies.read_state ?? readResearchCampaignState)(input.directory, input.campaign_id)
  if (current.kind === "error") return current
  if (current.state.status !== "RUNNING" || !current.state.abort_requested) {
    return {
      kind: "error",
      error_code: "STALE_STATE_REVISION",
      message: "Campaign changed while committing scheduler callback",
      current_state_revision: current.state.state_revision,
    }
  }
  const transition = reduceCampaignTransition(current.state, input.event)
  if (!transition.ok) {
    return { kind: "error", error_code: transition.error_code, message: transition.message }
  }
  return writeCampaignTransition({
    directory: input.directory,
    campaign_id: input.campaign_id,
    expected_state_revision: current.state.state_revision,
  }, transition.state, dependencies)
}
