import { join } from "node:path"

const REVISION_FILENAME = /^campaign\.rev-([0-9]{12})\.json$/
const MAX_REVISION = 999_999_999_999

export function formatResearchCampaignRevisionFilename(revision: number): string {
  if (!Number.isSafeInteger(revision) || revision < 0 || revision > MAX_REVISION) {
    throw new RangeError("Research campaign storage revision must fit twelve decimal digits")
  }
  return `campaign.rev-${revision.toString().padStart(12, "0")}.json`
}

export function parseResearchCampaignRevisionFilename(filename: string): number | null {
  const match = REVISION_FILENAME.exec(filename)
  return match?.[1] === undefined ? null : Number(match[1])
}

export function getResearchCampaignRevisionPath(campaignDirectory: string, revision: number): string {
  return join(campaignDirectory, formatResearchCampaignRevisionFilename(revision))
}
