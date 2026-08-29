import type { ResearchCampaignStateV1 } from "../state"
import { compareAndSwapResearchCampaignState, readResearchCampaignState } from "../storage"
import { reduceCampaignTransition, type CampaignTransitionEvent } from "../transitions"
import type { CampaignStateResult } from "./campaign-application-result"
import type { CampaignMutationDependencies } from "./campaign-mutation-dependencies"

export async function commitCampaignTransition(input: Readonly<{
  readonly directory: string
  readonly campaign_id: string
  readonly expected_state_revision: number
  readonly event: CampaignTransitionEvent
}>, dependencies: CampaignMutationDependencies = {}): Promise<CampaignStateResult> {
  const current = await (dependencies.read_state ?? readResearchCampaignState)(input.directory, input.campaign_id)
  if (current.kind === "error") return current
  if (current.state.state_revision !== input.expected_state_revision) {
    return staleCampaignRevision(input.expected_state_revision, current.state.state_revision)
  }
  const transition = reduceCampaignTransition(current.state, input.event)
  if (!transition.ok) {
    return { kind: "error", error_code: transition.error_code, message: transition.message }
  }
  return writeCampaignTransition(input, transition.state, dependencies)
}

export async function writeCampaignTransition(input: Readonly<{
  readonly directory: string
  readonly campaign_id: string
  readonly expected_state_revision: number
}>, state: ResearchCampaignStateV1, dependencies: CampaignMutationDependencies = {}): Promise<CampaignStateResult> {
  return (dependencies.compare_and_swap ?? compareAndSwapResearchCampaignState)({
    directory: input.directory,
    campaign_id: input.campaign_id,
    expected_state_revision: input.expected_state_revision,
    next_state: state,
  })
}

export function staleCampaignRevision(expected: number, current: number): CampaignStateResult {
  return {
    kind: "error",
    error_code: "STALE_STATE_REVISION",
    message: `Expected revision ${expected}, found ${current}`,
    current_state_revision: current,
  }
}
