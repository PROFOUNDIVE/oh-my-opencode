import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { writeFileSync } from "node:fs"
import { basename, join } from "node:path"

import { nodeStorageRuntime } from "../../workflow/storage/node-storage-runtime"
import type { StorageRuntime } from "../../workflow/storage/storage-runtime-contract"
import { compareAndSwapResearchCampaignState } from "./compare-and-swap"
import {
  acquireResearchCampaignOperationLock,
  releaseResearchCampaignOperationLock,
} from "./operation-lock"
import { readResearchCampaignState } from "./reader"
import { startResearchCampaignState } from "./start-reservation"
import { createStoredResearchCampaignState } from "./storage-test-state"
import { removeTemporaryCampaignDirectory, temporaryCampaignDirectory } from "../application/application-test-fixture"

describe("research campaign returned lock cleanup failures", () => {
  let directory: string

  beforeEach(() => {
    directory = temporaryCampaignDirectory()
  })

  afterEach(() => {
    removeTemporaryCampaignDirectory(directory)
  })

  test("retains returned start failure when write-lock release also fails", async () => {
    // given
    const state = createStoredResearchCampaignState("start-returned-failure", 0)
    await startResearchCampaignState({ directory, state })

    // when
    const result = await startResearchCampaignState({ directory, state }, releaseFailureRuntime())

    // then
    expectReturnedCleanupFailure(result, "CAMPAIGN_ALREADY_EXISTS", `Research campaign ${state.campaign_id} already exists`)
  })

  test("retains returned CAS failure when write-lock release also fails", async () => {
    // given
    const state = createStoredResearchCampaignState("cas-returned-failure", 0)
    await startResearchCampaignState({ directory, state })

    // when
    const result = await compareAndSwapResearchCampaignState({
      directory,
      campaign_id: state.campaign_id,
      expected_state_revision: 1,
      next_state: state,
    }, releaseFailureRuntime())

    // then
    expectReturnedCleanupFailure(result, "STALE_STATE_REVISION", "Expected research campaign revision 1, found 0")
  })

  test("retains returned operation acquisition failure when metadata-lock release also fails", async () => {
    // given
    const campaignDirectory = join(directory, "acquire-operation-returned-failure")
    await nodeStorageRuntime.mkdir(campaignDirectory)

    // when
    const result = await acquireResearchCampaignOperationLock({
      campaign_directory: campaignDirectory,
      operation_id: "",
    }, releaseFailureRuntime())

    // then
    expectReturnedCleanupFailure(result, "STORAGE_WRITE_FAILED", "Research campaign operation ID is invalid")
  })

  test("retains returned operation release failure when metadata-lock release also fails", async () => {
    // given
    const campaignDirectory = join(directory, "release-operation-returned-failure")
    await nodeStorageRuntime.mkdir(campaignDirectory)
    writeFileSync(join(campaignDirectory, ".operation.lock"), JSON.stringify({
      token: "operation-owner",
      pid: process.pid,
      operation_id: "operation-release-returned-failure",
      started_at: "2026-08-28T12:00:00.000Z",
    }))

    // when
    const result = await releaseResearchCampaignOperationLock({
      campaign_directory: campaignDirectory,
      token: "different-owner",
    }, releaseFailureRuntime())

    // then
    expectReturnedCleanupFailure(result, "STORAGE_BUSY", "Research campaign operation lock belongs to another owner")
  })

  test("returns the cleanup failure alone after successful start publication", async () => {
    // given
    const state = createStoredResearchCampaignState("start-success-release-failure", 0)

    // when
    const result = await startResearchCampaignState({ directory, state }, releaseFailureRuntime())

    // then
    expect(result).toEqual({
      kind: "error",
      error_code: "STORAGE_WRITE_FAILED",
      message: "Unable to release owned research campaign write lock",
    })
    expect(await readResearchCampaignState(directory, state.campaign_id)).toMatchObject({ kind: "ok", state: { state_revision: 0 } })
  })
})

function releaseFailureRuntime(): StorageRuntime {
  return {
    ...nodeStorageRuntime,
    unlink: async (path) => {
      if (basename(path) === ".write.lock") {
        throw Object.assign(new Error("Injected cleanup unlink failure"), { code: "EIO" })
      }
      await nodeStorageRuntime.unlink(path)
    },
  }
}

function expectReturnedCleanupFailure(result: unknown, errorCode: string, message: string): void {
  expect(result).toMatchObject({
    kind: "error",
    error_code: errorCode,
    message,
    cleanup_failure: {
      kind: "error",
      error_code: "STORAGE_WRITE_FAILED",
      message: "Unable to release owned research campaign write lock",
    },
  })
}
