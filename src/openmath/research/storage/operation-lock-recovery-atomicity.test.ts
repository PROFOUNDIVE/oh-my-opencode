import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { nodeStorageRuntime } from "../../workflow/storage/node-storage-runtime"
import type { StorageRuntime } from "../../workflow/storage/storage-runtime-contract"
import { acquireResearchCampaignOperationLock } from "./operation-lock"

describe("research operation-lock recovery atomicity", () => {
  let campaignDirectory: string

  beforeEach(() => {
    campaignDirectory = mkdtempSync(join(tmpdir(), "openmath-operation-recovery-"))
  })

  afterEach(() => {
    rmSync(campaignDirectory, { recursive: true, force: true })
  })

  test("keeps the public authority marker present while replacing a dead owner", async () => {
    // given
    const lockPath = join(campaignDirectory, ".operation.lock")
    writeFileSync(lockPath, JSON.stringify({
      token: "dead-owner",
      pid: 2_147_483_647,
      operation_id: "operation-recovery-marker",
      started_at: "2026-08-28T12:00:00.000Z",
    }))
    let publicMarkerRemoved = false
    const runtime: StorageRuntime = {
      ...nodeStorageRuntime,
      processStatus: () => "dead",
      token: () => "replacement-owner",
      unlink: async (path) => {
        if (path === lockPath) publicMarkerRemoved = true
        await nodeStorageRuntime.unlink(path)
      },
    }

    // when
    const result = await acquireResearchCampaignOperationLock({
      campaign_directory: campaignDirectory,
      operation_id: "operation-recovery-marker",
    }, runtime)

    // then
    expect(result).toMatchObject({ kind: "acquired", owner: { token: "replacement-owner" } })
    expect(publicMarkerRemoved).toBe(false)
    expect(existsSync(lockPath)).toBe(true)
  })

  test("reports recovery-candidate cleanup failure when owner identity changes", async () => {
    // given
    const lockPath = join(campaignDirectory, ".operation.lock")
    const replacementPath = join(campaignDirectory, ".operation-recovery-dead-owner-replacement-owner")
    writeFileSync(lockPath, JSON.stringify({
      token: "dead-owner",
      pid: 2_147_483_647,
      operation_id: "operation-recovery-cleanup",
      started_at: "2026-08-28T12:00:00.000Z",
    }))
    const runtime: StorageRuntime = {
      ...nodeStorageRuntime,
      processStatus: () => "dead",
      token: () => "replacement-owner",
      sameIdentity: async (path, identity) => path === lockPath ? false : nodeStorageRuntime.sameIdentity(path, identity),
      unlink: async (path) => {
        if (path === replacementPath) throw Object.assign(new Error("Injected cleanup failure"), { code: "EIO" })
        await nodeStorageRuntime.unlink(path)
      },
    }

    // when
    const result = await acquireResearchCampaignOperationLock({
      campaign_directory: campaignDirectory,
      operation_id: "operation-recovery-cleanup",
    }, runtime)

    // then
    expect(result).toMatchObject({ kind: "error", error_code: "STORAGE_WRITE_FAILED" })
    expect(existsSync(replacementPath)).toBe(true)
  })
})
