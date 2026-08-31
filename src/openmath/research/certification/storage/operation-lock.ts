import { nodeStorageRuntime } from "../../../workflow/storage/node-storage-runtime"
import type { StorageRuntime } from "../../../workflow/storage/storage-runtime-contract"
import { getResearchCampaignDirectory } from "../../storage/campaign-directory-hash"
import {
  acquireResearchCampaignOperationLock,
  readResearchCampaignOperationLock,
  releaseResearchCampaignOperationLock,
} from "../../storage/operation-lock"
import { CampaignIdSchema } from "../../state/literals"

type CertificationOperationIdentity = {
  readonly directory: string
  readonly campaign_id: string
}

export async function acquireCertificationOperationLock(
  request: CertificationOperationIdentity & { readonly operation_id: string },
  runtime: StorageRuntime = nodeStorageRuntime,
) {
  const campaignId = CampaignIdSchema.safeParse(request.campaign_id)
  if (!campaignId.success) {
    return { kind: "error", error_code: "STORAGE_WRITE_FAILED", message: "Certification operation campaign identity is invalid" } as const
  }
  return acquireResearchCampaignOperationLock({
    campaign_directory: getResearchCampaignDirectory(request.directory, campaignId.data),
    operation_id: request.operation_id,
  }, runtime)
}

export async function readCertificationOperationLock(
  request: CertificationOperationIdentity,
  runtime: StorageRuntime = nodeStorageRuntime,
) {
  const campaignId = CampaignIdSchema.safeParse(request.campaign_id)
  if (!campaignId.success) {
    return { kind: "error", error_code: "STORAGE_READ_FAILED", message: "Certification operation campaign identity is invalid" } as const
  }
  return readResearchCampaignOperationLock(getResearchCampaignDirectory(request.directory, campaignId.data), runtime)
}

export async function releaseCertificationOperationLock(
  request: CertificationOperationIdentity & { readonly token: string },
  runtime: StorageRuntime = nodeStorageRuntime,
) {
  const campaignId = CampaignIdSchema.safeParse(request.campaign_id)
  if (!campaignId.success) {
    return { kind: "error", error_code: "STORAGE_WRITE_FAILED", message: "Certification operation campaign identity is invalid" } as const
  }
  return releaseResearchCampaignOperationLock({
    campaign_directory: getResearchCampaignDirectory(request.directory, campaignId.data),
    token: request.token,
  }, runtime)
}
