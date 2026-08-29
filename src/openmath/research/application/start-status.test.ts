import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, readdirSync } from "node:fs"

import { getResearchCampaignDirectory } from "../storage"
import {
  objectiveSnapshot,
  profileSnapshot,
  referenceSnapshot,
  removeTemporaryCampaignDirectory,
  temporaryCampaignDirectory,
} from "./application-test-fixture"
import { getResearchCampaignStatus } from "./get-research-campaign-status"
import { CampaignSourceResolutionError } from "./campaign-source-resolution-error"
import { startResearchCampaign } from "./start-research-campaign"

describe("campaign start and status", () => {
  let directory: string

  beforeEach(() => {
    directory = temporaryCampaignDirectory()
  })

  afterEach(() => {
    removeTemporaryCampaignDirectory(directory)
  })

  test("resolves frozen sources, reserves revision zero, and dispatches no child", async () => {
    // given
    const calls: string[] = []
    const references = referenceSnapshot()

    // when
    const result = await startResearchCampaign({
      directory,
      campaign_id: "campaign-start",
      parent_session_id: "ses_parent1",
    }, {
      resolve_objective: async () => {
        calls.push("objective")
        return objectiveSnapshot()
      },
      resolve_references: async () => {
        calls.push("references")
        return references
      },
      resolve_profile: async (resolvedReferences) => {
        calls.push("profile")
        expect(resolvedReferences).toEqual(references)
        return profileSnapshot(resolvedReferences)
      },
    })

    // then
    expect(result).toMatchObject({ ok: true, campaign_id: "campaign-start", state_revision: 0, phase: "DISCOVERY", status: "READY" })
    expect(calls).toEqual(["objective", "references", "profile"])
    const campaignDirectory = getResearchCampaignDirectory(directory, "campaign-start")
    expect(readdirSync(campaignDirectory)).toEqual(["campaign.rev-000000000000.json"])
    expect(existsSync(`${campaignDirectory}/.operation.lock`)).toBe(false)
  })

  test("status is side-effect-free and performs no repair", async () => {
    // given
    await startResearchCampaign({
      directory,
      campaign_id: "campaign-status",
      parent_session_id: "ses_parent1",
    }, {
      resolve_objective: async () => objectiveSnapshot(),
      resolve_references: async () => referenceSnapshot(),
      resolve_profile: async (references) => profileSnapshot(references),
    })
    const campaignDirectory = getResearchCampaignDirectory(directory, "campaign-status")
    const before = readdirSync(campaignDirectory)

    // when
    const result = await getResearchCampaignStatus({ directory, campaign_id: "campaign-status" })

    // then
    expect(result).toMatchObject({ ok: true, campaign_id: "campaign-status", state_revision: 0 })
    expect(readdirSync(campaignDirectory)).toEqual(before)
    expect(existsSync(`${campaignDirectory}/.operation.lock`)).toBe(false)
  })

  test("returns a typed source error before state allocation", async () => {
    // given
    const campaignDirectory = getResearchCampaignDirectory(directory, "campaign-source-error")

    // when
    const result = await startResearchCampaign({
      directory,
      campaign_id: "campaign-source-error",
      parent_session_id: "ses_parent1",
    }, {
      resolve_objective: async () => {
        throw new CampaignSourceResolutionError("objective source is unavailable")
      },
      resolve_references: async () => referenceSnapshot(),
      resolve_profile: async (references) => profileSnapshot(references),
    })

    // then
    expect(result).toEqual({ ok: false, error_code: "SOURCE_ERROR", message: "objective source is unavailable" })
    expect(existsSync(campaignDirectory)).toBe(false)
  })
})
