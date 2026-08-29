import {
  acquireResearchCampaignOperationLock,
  readResearchCampaignOperationLock,
  releaseResearchCampaignOperationLock,
  type ResearchCampaignOperationLockResult,
} from "../storage"
import type { CampaignStepDependencies } from "./campaign-scheduler-contract"

export async function acquireCampaignOperation(input: Readonly<{
  readonly campaign_directory: string
  readonly operation_id: string
}>, dependencies: CampaignStepDependencies): Promise<ResearchCampaignOperationLockResult> {
  const inspection = await (dependencies.read_lock ?? readResearchCampaignOperationLock)(input.campaign_directory)
  if (inspection.kind === "error") return inspection
  const staleDeadOwner = inspection.kind === "owned"
    && inspection.process_status === "dead"
    && inspection.owner.operation_id !== input.operation_id
  if (staleDeadOwner) {
    const retired = await (dependencies.acquire_lock ?? acquireResearchCampaignOperationLock)({
      campaign_directory: input.campaign_directory,
      operation_id: inspection.owner.operation_id,
    })
    if (retired.kind === "error") return retired
    const released = await (dependencies.release_lock ?? releaseResearchCampaignOperationLock)({
      campaign_directory: input.campaign_directory,
      token: retired.owner.token,
    })
    if (released.kind === "error") return released
  }
  return (dependencies.acquire_lock ?? acquireResearchCampaignOperationLock)(input)
}
