import { afterEach, beforeEach, expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"

import { nodeStorageRuntime } from "../../workflow/storage/node-storage-runtime"
import type { StorageRuntime } from "../../workflow/storage/storage-runtime-contract"
import { compareAndSwapResearchCampaignState } from "./compare-and-swap"
import { getResearchCampaignDirectory } from "./campaign-directory-hash"
import { startResearchCampaignState } from "./start-reservation"
import { createStoredResearchCampaignState } from "./storage-test-state"

let directory: string

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "openmath-research-publication-lock-"))
})

afterEach(() => {
  rmSync(directory, { recursive: true, force: true })
})

test("holds the campaign write lock through immutable revision publication", async () => {
  // given
  const campaignId = "publication-lock"
  const initial = createStoredResearchCampaignState(campaignId, 0)
  await startResearchCampaignState({ directory, state: initial })
  const campaignDirectory = getResearchCampaignDirectory(directory, campaignId)
  let publishedWhileLocked = false
  const runtime: StorageRuntime = {
    ...nodeStorageRuntime,
    link: async (source, destination) => {
      if (basename(destination).startsWith("campaign.rev-")) {
        publishedWhileLocked = existsSync(join(campaignDirectory, ".write.lock"))
      }
      await nodeStorageRuntime.link(source, destination)
    },
  }

  // when
  const result = await compareAndSwapResearchCampaignState({
    directory,
    campaign_id: campaignId,
    expected_state_revision: 0,
    next_state: initial,
  }, runtime)

  // then
  expect(result).toMatchObject({ kind: "ok", state: { state_revision: 1 } })
  expect(publishedWhileLocked).toBe(true)
  expect(existsSync(join(campaignDirectory, ".write.lock"))).toBe(false)
})

test("releases the start write lock when an unexpected writer exception escapes", async () => {
  // given
  const state = createStoredResearchCampaignState("start-exception", 0)
  const campaignDirectory = getResearchCampaignDirectory(directory, state.campaign_id)
  let tokenCalls = 0
  const runtime: StorageRuntime = {
    ...nodeStorageRuntime,
    token: () => {
      tokenCalls += 1
      if (tokenCalls === 1) return "start-write-owner"
      throw new TypeError("Injected writer token failure")
    },
  }

  // when
  const starting = startResearchCampaignState({ directory, state }, runtime)

  // then
  await expect(starting).rejects.toThrow("Injected writer token failure")
  expect(existsSync(join(campaignDirectory, ".write.lock"))).toBe(false)
})

test("releases the CAS write lock when an unexpected writer exception escapes", async () => {
  // given
  const campaignId = "cas-exception"
  const state = createStoredResearchCampaignState(campaignId, 0)
  await startResearchCampaignState({ directory, state })
  const campaignDirectory = getResearchCampaignDirectory(directory, campaignId)
  let tokenCalls = 0
  const runtime: StorageRuntime = {
    ...nodeStorageRuntime,
    token: () => {
      tokenCalls += 1
      if (tokenCalls === 1) return "cas-write-owner"
      throw new TypeError("Injected writer token failure")
    },
  }

  // when
  const mutating = compareAndSwapResearchCampaignState({
    directory,
    campaign_id: campaignId,
    expected_state_revision: 0,
    next_state: state,
  }, runtime)

  // then
  await expect(mutating).rejects.toThrow("Injected writer token failure")
  expect(existsSync(join(campaignDirectory, ".write.lock"))).toBe(false)
})
