import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"

import { nodeStorageRuntime } from "../../workflow/storage/node-storage-runtime"
import type { StorageRuntime } from "../../workflow/storage/storage-runtime-contract"
import { compareAndSwapResearchCampaignState } from "./compare-and-swap"
import { getResearchCampaignDirectory } from "./campaign-directory-hash"
import {
  acquireResearchCampaignOperationLock,
  releaseResearchCampaignOperationLock,
} from "./operation-lock"
import { startResearchCampaignState } from "./start-reservation"
import { createStoredResearchCampaignState } from "./storage-test-state"

describe("research campaign durable lock cleanup failures", () => {
  let directory: string

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "openmath-research-cleanup-failure-"))
  })

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  test("preserves the start failure when its write-lock release also fails", async () => {
    // given
    const state = createStoredResearchCampaignState("start-cleanup-failure", 0)
    const campaignDirectory = getResearchCampaignDirectory(directory, state.campaign_id)
    const primaryMessage = "Injected start writer failure"

    // when
    const starting = startResearchCampaignState({ directory, state }, writerAndCleanupFailureRuntime(primaryMessage))

    // then
    await expectCombinedCleanupFailure(starting, primaryMessage)
    expect(existsSync(join(campaignDirectory, ".write.lock"))).toBe(true)
  })

  test("preserves the CAS failure when its write-lock release also fails", async () => {
    // given
    const state = createStoredResearchCampaignState("cas-cleanup-failure", 0)
    await startResearchCampaignState({ directory, state })
    const campaignDirectory = getResearchCampaignDirectory(directory, state.campaign_id)
    const primaryMessage = "Injected CAS writer failure"

    // when
    const mutating = compareAndSwapResearchCampaignState({
      directory,
      campaign_id: state.campaign_id,
      expected_state_revision: 0,
      next_state: state,
    }, writerAndCleanupFailureRuntime(primaryMessage))

    // then
    await expectCombinedCleanupFailure(mutating, primaryMessage)
    expect(existsSync(join(campaignDirectory, ".write.lock"))).toBe(true)
  })

  test("preserves operation-lock acquisition failure when metadata-lock release also fails", async () => {
    // given
    const campaignDirectory = join(directory, "acquire-operation")
    await nodeStorageRuntime.mkdir(campaignDirectory)
    const primaryMessage = "Injected operation owner failure"

    // when
    const acquiring = acquireResearchCampaignOperationLock({
      campaign_directory: campaignDirectory,
      operation_id: "operation-acquire-cleanup",
    }, writerAndCleanupFailureRuntime(primaryMessage))

    // then
    await expectCombinedCleanupFailure(acquiring, primaryMessage)
    expect(existsSync(join(campaignDirectory, ".write.lock"))).toBe(true)
    expect(existsSync(join(campaignDirectory, ".operation.lock"))).toBe(false)
  })

  test("preserves operation-lock release failure when metadata-lock release also fails", async () => {
    // given
    const campaignDirectory = join(directory, "release-operation")
    await nodeStorageRuntime.mkdir(campaignDirectory)
    const operationPath = join(campaignDirectory, ".operation.lock")
    const writeLockPath = join(campaignDirectory, ".write.lock")
    const primaryMessage = "Injected operation identity failure"
    const owner = {
      token: "operation-owner",
      pid: process.pid,
      operation_id: "operation-release-cleanup",
      started_at: "2026-08-28T12:00:00.000Z",
    }
    const ownerBytes = JSON.stringify(owner)
    writeFileSync(operationPath, ownerBytes)
    const runtime: StorageRuntime = {
      ...nodeStorageRuntime,
      sameIdentity: async (path, identity) => {
        if (path === operationPath) throw new TypeError(primaryMessage)
        return nodeStorageRuntime.sameIdentity(path, identity)
      },
      unlink: async (path) => {
        if (path === writeLockPath) throw Object.assign(new Error("Injected cleanup unlink failure"), { code: "EIO" })
        await nodeStorageRuntime.unlink(path)
      },
    }

    // when
    const releasing = releaseResearchCampaignOperationLock({
      campaign_directory: campaignDirectory,
      token: owner.token,
    }, runtime)

    // then
    await expectCombinedCleanupFailure(releasing, primaryMessage)
    expect(readFileSync(operationPath, "utf8")).toBe(ownerBytes)
    expect(existsSync(writeLockPath)).toBe(true)
  })

})

function writerAndCleanupFailureRuntime(primaryMessage: string): StorageRuntime {
  let tokenCalls = 0
  return {
    ...nodeStorageRuntime,
    token: () => {
      tokenCalls += 1
      if (tokenCalls === 1) return "write-lock-owner"
      throw new TypeError(primaryMessage)
    },
    unlink: async (path) => {
      if (basename(path) === ".write.lock") {
        throw Object.assign(new Error("Injected cleanup unlink failure"), { code: "EIO" })
      }
      await nodeStorageRuntime.unlink(path)
    },
  }
}

async function expectCombinedCleanupFailure(promise: Promise<unknown>, primaryMessage: string): Promise<void> {
  await expect(promise).rejects.toMatchObject({
    name: "ResearchCampaignLockCleanupError",
    operation_error: { name: "TypeError", message: primaryMessage },
    cleanup_failure: {
      kind: "error",
      error_code: "STORAGE_WRITE_FAILED",
      message: "Unable to release owned research campaign write lock",
    },
  })
}
