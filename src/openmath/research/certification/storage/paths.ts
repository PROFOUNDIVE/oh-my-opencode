import { join, posix } from "node:path"

import { getResearchCampaignDirectory } from "../../storage/campaign-directory-hash"
import { CampaignIdSchema } from "../../state/literals"
import { CertificationGenerationIdSchema, CertificationRevisionSchema } from "../state/literals"

const REVISION_FILENAME = /^certification\.rev-([0-9]{12})\.json$/

export function formatCertificationRevisionFilename(revision: number): string {
  const parsed = CertificationRevisionSchema.safeParse(revision)
  if (!parsed.success) throw new RangeError("Certification storage revision must fit twelve decimal digits")
  return `certification.rev-${parsed.data.toString().padStart(12, "0")}.json`
}

export function parseCertificationRevisionFilename(filename: string): number | null {
  const match = REVISION_FILENAME.exec(filename)
  return match?.[1] === undefined ? null : Number(match[1])
}

export function getCertificationDirectory(directory: string, campaignId: string): string {
  const parsedCampaignId = CampaignIdSchema.parse(campaignId)
  return join(getResearchCampaignDirectory(directory, parsedCampaignId), "certification")
}

export function getCertificationGenerationDirectory(
  directory: string,
  campaignId: string,
  generationId: string,
): string {
  const parsedGenerationId = CertificationGenerationIdSchema.parse(generationId)
  return join(getCertificationDirectory(directory, campaignId), parsedGenerationId)
}

export function getCertificationGenerationIndexPath(directory: string, campaignId: string): string {
  return join(getCertificationDirectory(directory, campaignId), "generation-index.json")
}

export function getCertificationRevisionPath(generationDirectory: string, revision: number): string {
  return join(generationDirectory, formatCertificationRevisionFilename(revision))
}

export function getCertificationStorageRef(generationId: string, revision: number): string {
  const parsedGenerationId = CertificationGenerationIdSchema.parse(generationId)
  return posix.join("certification", parsedGenerationId, formatCertificationRevisionFilename(revision))
}
