import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { relative, resolve } from "node:path"

import { sha256 } from "../../workflow/stage-runner/sha256"
import { getWorkflowRunDirectory } from "../../workflow/storage"
import { formatWorkflowRevisionFilename } from "../../workflow/storage/revision-filename"
import { certifiedPromotionFixture } from "../certification/application/certification-application-test-fixture"
import { getResearchCampaignDirectory } from "../storage"
import { formatResearchCampaignRevisionFilename } from "../storage/revision-filename"
import { removeTemporaryCampaignDirectory, temporaryCampaignDirectory } from "../application/application-test-fixture"

export function createCertificationStoreFixture() {
  const directory = temporaryCampaignDirectory()
  const fixture = certifiedPromotionFixture()
  const campaignDirectory = getResearchCampaignDirectory(directory, fixture.campaign.campaign_id)
  const workflowDirectory = getWorkflowRunDirectory(directory, fixture.child.run_id)
  mkdirSync(campaignDirectory, { recursive: true })
  mkdirSync(workflowDirectory, { recursive: true })
  writeFileSync(
    resolve(campaignDirectory, formatResearchCampaignRevisionFilename(fixture.campaign.state_revision)),
    JSON.stringify(fixture.campaign),
  )
  writeFileSync(
    resolve(workflowDirectory, formatWorkflowRevisionFilename(fixture.child.state_revision)),
    JSON.stringify(fixture.child),
  )
  return {
    directory,
    fixture,
    cleanup: () => removeTemporaryCampaignDirectory(directory),
    snapshot: () => storeSnapshot(directory),
  }
}

export function storeSnapshot(directory: string): readonly Readonly<{
  readonly path: string
  readonly sha256: string
}>[] {
  return filesBelow(directory).map((path) => ({
    path: relative(directory, path),
    sha256: sha256(readFileSync(path)),
  }))
}

function filesBelow(directory: string): readonly string[] {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = resolve(directory, entry.name)
      return entry.isDirectory() ? filesBelow(path) : [path]
    })
    .sort()
}
