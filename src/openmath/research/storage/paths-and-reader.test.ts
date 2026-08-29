import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { readWorkflowState } from "../../workflow/storage"
import { getWorkflowRevisionPath } from "../../workflow/storage/revision-filename"
import { getWorkflowRunDirectory } from "../../workflow/storage/run-directory-hash"
import { createStoredWorkflowState } from "../../workflow/storage/storage-test-state"
import { getResearchCampaignDirectory } from "./campaign-directory-hash"
import { readResearchCampaignState } from "./reader"
import {
  formatResearchCampaignRevisionFilename,
  getResearchCampaignRevisionPath,
  parseResearchCampaignRevisionFilename,
} from "./revision-filename"
import { createStoredResearchCampaignState } from "./storage-test-state"

describe("research campaign storage paths", () => {
  test("hashes the campaign ID into the campaign-only namespace", () => {
    // given
    const directory = "/tmp/openmath-storage-root"
    const campaignId = "campaign-1"
    const hash = createHash("sha256").update(campaignId, "utf8").digest("hex")

    // when
    const campaignDirectory = getResearchCampaignDirectory(directory, campaignId)

    // then
    expect(campaignDirectory).toBe(join(directory, ".sisyphus", "openmath-research-campaigns", hash))
    expect(campaignDirectory).not.toBe(getWorkflowRunDirectory(directory, campaignId))
  })

  test("formats and strictly parses twelve-digit campaign revision filenames", () => {
    // when
    const filename = formatResearchCampaignRevisionFilename(42)

    // then
    expect(filename).toBe("campaign.rev-000000000042.json")
    expect(parseResearchCampaignRevisionFilename(filename)).toBe(42)
    expect(parseResearchCampaignRevisionFilename("state.rev-000000000042.json")).toBeNull()
    expect(parseResearchCampaignRevisionFilename("campaign.rev-42.json")).toBeNull()
    expect(() => formatResearchCampaignRevisionFilename(-1)).toThrow(RangeError)
    expect(() => formatResearchCampaignRevisionFilename(1_000_000_000_000)).toThrow(RangeError)
  })
})

describe("research campaign revision reader", () => {
  let directory: string

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "openmath-research-reader-"))
  })

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  test("returns the highest allocated campaign revision when lower content is corrupt", async () => {
    // given
    const campaignId = "highest-valid"
    const campaignDirectory = getResearchCampaignDirectory(directory, campaignId)
    mkdirSync(campaignDirectory, { recursive: true })
    writeFileSync(getResearchCampaignRevisionPath(campaignDirectory, 0), "{corrupt")
    writeFileSync(
      getResearchCampaignRevisionPath(campaignDirectory, 3),
      JSON.stringify(createStoredResearchCampaignState(campaignId, 3)),
    )
    writeFileSync(join(campaignDirectory, ".tmp-campaign.rev-999999999999.json"), "{corrupt")

    // when
    const result = await readResearchCampaignState(directory, campaignId)

    // then
    expect(result).toMatchObject({ kind: "ok", state: { campaign_id: campaignId, state_revision: 3 } })
  })

  test("fails closed on a corrupt highest revision instead of falling back", async () => {
    // given
    const campaignId = "corrupt-highest"
    const campaignDirectory = getResearchCampaignDirectory(directory, campaignId)
    mkdirSync(campaignDirectory, { recursive: true })
    writeFileSync(
      getResearchCampaignRevisionPath(campaignDirectory, 1),
      JSON.stringify(createStoredResearchCampaignState(campaignId, 1)),
    )
    writeFileSync(getResearchCampaignRevisionPath(campaignDirectory, 2), "{corrupt")

    // when
    const result = await readResearchCampaignState(directory, campaignId)

    // then
    expect(result).toMatchObject({ kind: "error", error_code: "STORAGE_READ_FAILED" })
  })

  test("rejects campaign identity or revision that disagrees with its allocation", async () => {
    // given
    const campaignId = "identity-check"
    const campaignDirectory = getResearchCampaignDirectory(directory, campaignId)
    const revisionPath = getResearchCampaignRevisionPath(campaignDirectory, 4)
    mkdirSync(campaignDirectory, { recursive: true })
    writeFileSync(revisionPath, JSON.stringify(createStoredResearchCampaignState("other-campaign", 4)))

    // when
    const wrongCampaign = await readResearchCampaignState(directory, campaignId)
    writeFileSync(revisionPath, JSON.stringify(createStoredResearchCampaignState(campaignId, 3)))
    const wrongRevision = await readResearchCampaignState(directory, campaignId)

    // then
    expect(wrongCampaign).toMatchObject({ kind: "error", error_code: "STORAGE_READ_FAILED" })
    expect(wrongRevision).toMatchObject({ kind: "error", error_code: "STORAGE_READ_FAILED" })
  })

  test("keeps workflow and campaign namespaces mutually invisible", async () => {
    // given
    const sharedId = "namespace-isolation"
    const workflowDirectory = getWorkflowRunDirectory(directory, sharedId)
    mkdirSync(workflowDirectory, { recursive: true })
    writeFileSync(
      getWorkflowRevisionPath(workflowDirectory, 0),
      JSON.stringify(createStoredWorkflowState(sharedId, 0)),
    )

    // when
    const campaignRead = await readResearchCampaignState(directory, sharedId)
    const campaignDirectory = getResearchCampaignDirectory(directory, sharedId)
    mkdirSync(campaignDirectory, { recursive: true })
    writeFileSync(
      getResearchCampaignRevisionPath(campaignDirectory, 0),
      JSON.stringify(createStoredResearchCampaignState(sharedId, 0)),
    )
    const workflowRead = await readWorkflowState(directory, sharedId)

    // then
    expect(campaignRead).toMatchObject({ kind: "error", error_code: "CAMPAIGN_NOT_FOUND" })
    expect(workflowRead).toMatchObject({ kind: "ok", state: { run_id: sharedId, state_revision: 0 } })
  })
})
