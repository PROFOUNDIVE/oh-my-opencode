import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { compareAndSwapResearchCampaignState } from "./compare-and-swap"
import { getResearchCampaignDirectory } from "./campaign-directory-hash"
import { readResearchCampaignState } from "./reader"
import { getResearchCampaignRevisionPath } from "./revision-filename"
import { startResearchCampaignState } from "./start-reservation"
import { createStoredResearchCampaignState } from "./storage-test-state"

describe("research campaign revision mutation", () => {
  let directory: string

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "openmath-research-mutation-"))
  })

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  test("allows one concurrent start and rejects the other as already existing", async () => {
    // given
    const state = createStoredResearchCampaignState("start-race", 0)

    // when
    const results = await Promise.all([
      startResearchCampaignState({ directory, state }),
      startResearchCampaignState({ directory, state }),
    ])

    // then
    expect(results.map((result) => result.kind).sort()).toEqual(["error", "ok"])
    expect(results.find((result) => result.kind === "error")).toMatchObject({
      error_code: "CAMPAIGN_ALREADY_EXISTS",
    })
    expect(await readResearchCampaignState(directory, state.campaign_id)).toMatchObject({
      kind: "ok",
      state: { state_revision: 0 },
    })
  })

  test("allows one same-revision CAS winner and reports the loser as stale", async () => {
    // given
    const campaignId = "cas-race"
    const initial = createStoredResearchCampaignState(campaignId, 0)
    await startResearchCampaignState({ directory, state: initial })
    const campaignDirectory = getResearchCampaignDirectory(directory, campaignId)
    const revisionZeroPath = getResearchCampaignRevisionPath(campaignDirectory, 0)
    const revisionZeroBytes = readFileSync(revisionZeroPath, "utf8")

    // when
    const results = await Promise.all([
      compareAndSwapResearchCampaignState({
        directory,
        campaign_id: campaignId,
        expected_state_revision: 0,
        next_state: initial,
      }),
      compareAndSwapResearchCampaignState({
        directory,
        campaign_id: campaignId,
        expected_state_revision: 0,
        next_state: initial,
      }),
    ])

    // then
    expect(results.map((result) => result.kind).sort()).toEqual(["error", "ok"])
    expect(results.find((result) => result.kind === "error")).toMatchObject({
      error_code: "STALE_STATE_REVISION",
      current_state_revision: 1,
    })
    expect(readFileSync(revisionZeroPath, "utf8")).toBe(revisionZeroBytes)
    expect(await readResearchCampaignState(directory, campaignId)).toMatchObject({
      kind: "ok",
      state: { state_revision: 1 },
    })
    expect(readdirSync(campaignDirectory).filter((name) => name.startsWith(".tmp-"))).toEqual([])
  })

  test("requires a strict revision-zero start and matching CAS identity", async () => {
    // given
    const campaignId = "strict-mutation"
    const initial = createStoredResearchCampaignState(campaignId, 0)
    const nonzero = createStoredResearchCampaignState("nonzero-start", 1)

    // when
    const rejectedStart = await startResearchCampaignState({ directory, state: nonzero })
    await startResearchCampaignState({ directory, state: initial })
    const rejectedCas = await compareAndSwapResearchCampaignState({
      directory,
      campaign_id: campaignId,
      expected_state_revision: 0,
      next_state: createStoredResearchCampaignState("different-campaign", 0),
    })

    // then
    expect(rejectedStart).toMatchObject({ kind: "error", error_code: "STORAGE_WRITE_FAILED" })
    expect(rejectedCas).toMatchObject({ kind: "error", error_code: "STORAGE_WRITE_FAILED" })
  })
})
