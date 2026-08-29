import {
  compareAndSwapResearchCampaignState,
  readResearchCampaignState,
} from "../storage"

export type CampaignMutationDependencies = Readonly<{
  readonly read_state?: typeof readResearchCampaignState
  readonly compare_and_swap?: typeof compareAndSwapResearchCampaignState
}>
