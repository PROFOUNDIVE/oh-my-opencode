import { mkdirSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

import { getWorkflowRunDirectory } from "../../workflow/storage"
import { formatWorkflowRevisionFilename } from "../../workflow/storage/revision-filename"
import { buildCertificationGenerationIndex } from "../certification/storage/generation-index"
import {
  getCertificationGenerationDirectory,
  getCertificationGenerationIndexPath,
  getCertificationRevisionPath,
} from "../certification/storage"
import { promotionDossierV2Inputs } from "../dossier/promotion-dossier-v2-test-support"
import { getResearchCampaignDirectory } from "../storage"
import { formatResearchCampaignRevisionFilename } from "../storage/revision-filename"
import { removeTemporaryCampaignDirectory, temporaryCampaignDirectory } from "../application/application-test-fixture"

export function createCertificationV2StoreFixture(
  witnessOutcome?: "CONFIRMED" | "REJECTED" | "INCONCLUSIVE",
) {
  const directory = temporaryCampaignDirectory()
  const fixture = promotionDossierV2Inputs(witnessOutcome)
  const campaignDirectory = getResearchCampaignDirectory(directory, fixture.campaign.campaign_id)
  const workflowDirectory = getWorkflowRunDirectory(directory, fixture.child.run_id)
  const generationDirectory = getCertificationGenerationDirectory(
    directory,
    fixture.campaign.campaign_id,
    fixture.certification.generation_id,
  )
  mkdirSync(campaignDirectory, { recursive: true })
  mkdirSync(workflowDirectory, { recursive: true })
  mkdirSync(generationDirectory, { recursive: true })
  writeFileSync(
    resolve(campaignDirectory, formatResearchCampaignRevisionFilename(fixture.campaign.state_revision)),
    JSON.stringify(fixture.campaign),
  )
  writeFileSync(
    resolve(workflowDirectory, formatWorkflowRevisionFilename(fixture.child.state_revision)),
    JSON.stringify(fixture.child),
  )
  writeFileSync(
    getCertificationRevisionPath(generationDirectory, fixture.certification.certification_revision),
    JSON.stringify(fixture.certification),
  )
  writeFileSync(
    getCertificationGenerationIndexPath(directory, fixture.campaign.campaign_id),
    JSON.stringify(buildCertificationGenerationIndex(fixture.certification, 10)),
  )
  return {
    directory,
    fixture,
    cleanup: () => removeTemporaryCampaignDirectory(directory),
  }
}
