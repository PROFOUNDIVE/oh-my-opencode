import { createHash } from "node:crypto"
import { join } from "node:path"

export function getResearchCampaignDirectory(directory: string, campaignId: string): string {
  const campaignHash = createHash("sha256").update(campaignId, "utf8").digest("hex")
  return join(directory, ".sisyphus", "openmath-research-campaigns", campaignHash)
}
