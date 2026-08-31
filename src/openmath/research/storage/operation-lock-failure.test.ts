import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { nodeStorageRuntime } from "../../workflow/storage/node-storage-runtime"
import type { StorageRuntime } from "../../workflow/storage/storage-runtime-contract"
import {
  acquireResearchCampaignOperationLock,
  readResearchCampaignOperationLock,
  releaseResearchCampaignOperationLock,
} from "./operation-lock"

describe("research campaign operation lock failures", () => {
  let campaignDirectory: string

  beforeEach(() => {
    campaignDirectory = mkdtempSync(join(tmpdir(), "openmath-research-operation-failure-"))
  })

  afterEach(() => {
    rmSync(campaignDirectory, { recursive: true, force: true })
  })

  test("rejects an invalid operation ID before allocating the durable lock", async () => {
    // when
    const result = await acquireResearchCampaignOperationLock({
      campaign_directory: campaignDirectory,
      operation_id: "   ",
    })

    // then
    expect(result).toMatchObject({ kind: "error", error_code: "STORAGE_WRITE_FAILED" })
    expect(existsSync(join(campaignDirectory, ".operation.lock"))).toBe(false)
  })

  test("fails closed on a malformed existing operation owner", async () => {
    const lockPath = join(campaignDirectory, ".operation.lock")
    writeFileSync(lockPath, "{corrupt")

    // when
    const read = await readResearchCampaignOperationLock(campaignDirectory)
    const acquired = await acquireResearchCampaignOperationLock({
      campaign_directory: campaignDirectory,
      operation_id: "operation-1",
    })

    // then
    expect(read).toMatchObject({ kind: "error", error_code: "STORAGE_READ_FAILED" })
    expect(acquired).toMatchObject({ kind: "error", error_code: "STORAGE_READ_FAILED" })
    expect(readFileSync(lockPath, "utf8")).toBe("{corrupt")
  })

  test("release preserves a replacement owner installed after inspection", async () => {
    // given
    const lockPath = join(campaignDirectory, ".operation.lock")
    const original = JSON.stringify({
      token: "original-owner",
      pid: process.pid,
      operation_id: "operation-1",
      started_at: "2026-08-28T12:00:00.000Z",
    })
    const replacement = JSON.stringify({
      token: "replacement-owner",
      pid: process.pid,
      operation_id: "operation-2",
      started_at: "2026-08-28T12:00:01.000Z",
    })
    writeFileSync(lockPath, original)
    let replaced = false
    const runtime: StorageRuntime = {
      ...nodeStorageRuntime,
      sameIdentity: async (path, identity) => {
        if (path === lockPath && !replaced) {
          replaced = true
          unlinkSync(lockPath)
          writeFileSync(lockPath, replacement)
        }
        return nodeStorageRuntime.sameIdentity(path, identity)
      },
    }

    // when
    const result = await releaseResearchCampaignOperationLock({
      campaign_directory: campaignDirectory,
      token: "original-owner",
    }, runtime)

    // then
    expect(result).toMatchObject({ kind: "error", error_code: "STORAGE_BUSY" })
    expect(readFileSync(lockPath, "utf8")).toBe(replacement)
  })

  test("closes the inspected handle when dead-owner process inspection throws", async () => {
    // given
    const lockPath = join(campaignDirectory, ".operation.lock")
    writeFileSync(lockPath, JSON.stringify({
      token: "dead-owner",
      pid: 2_147_483_647,
      operation_id: "operation-process-status-throws",
      started_at: "2026-08-28T12:00:00.000Z",
    }))
    let closed = 0
    const runtime = closingRuntime(lockPath, () => { throw new TypeError("Injected process-status failure") })

    const acquiring = acquireResearchCampaignOperationLock({
      campaign_directory: campaignDirectory,
      operation_id: "operation-process-status-throws",
    }, runtime)

    await expect(acquiring).rejects.toThrow("Injected process-status failure")
    expect(closed).toBe(1)

    function closingRuntime(path: string, processStatus: () => never): StorageRuntime {
      return {
        ...nodeStorageRuntime,
        open: async (openedPath, flags) => {
          const handle = await nodeStorageRuntime.open(openedPath, flags)
          return { ...handle, close: async () => { if (openedPath === path) closed += 1; await handle.close() } }
        },
        processStatus,
      }
    }
  })

  test("closes the inspected handle when owner identity comparison throws", async () => {
    const lockPath = join(campaignDirectory, ".operation.lock")
    writeFileSync(lockPath, JSON.stringify({
      token: "operation-owner",
      pid: process.pid,
      operation_id: "operation-identity-throws",
      started_at: "2026-08-28T12:00:00.000Z",
    }))
    let closed = 0
    const runtime: StorageRuntime = {
      ...nodeStorageRuntime,
      open: async (openedPath, flags) => {
        const handle = await nodeStorageRuntime.open(openedPath, flags)
        return { ...handle, close: async () => { if (openedPath === lockPath) closed += 1; await handle.close() } }
      },
      sameIdentity: async (path, identity) => {
        if (path === lockPath) throw new TypeError("Injected identity failure")
        return nodeStorageRuntime.sameIdentity(path, identity)
      },
    }

    const releasing = releaseResearchCampaignOperationLock({
      campaign_directory: campaignDirectory,
      token: "operation-owner",
    }, runtime)

    await expect(releasing).rejects.toThrow("Injected identity failure")
    expect(closed).toBe(1)
  })

  test("serializes operation-lock publication and release with the campaign write lock", async () => {
    // given
    const operationPath = join(campaignDirectory, ".operation.lock")
    const writeLockPath = join(campaignDirectory, ".write.lock")
    let acquiredWhileSerialized = false
    let releasedWhileSerialized = false
    const runtime: StorageRuntime = {
      ...nodeStorageRuntime,
      writeExclusive: async (path, content) => {
        if (path === operationPath) acquiredWhileSerialized = existsSync(writeLockPath)
        await nodeStorageRuntime.writeExclusive(path, content)
      },
      unlink: async (path) => {
        if (path === operationPath) releasedWhileSerialized = existsSync(writeLockPath)
        await nodeStorageRuntime.unlink(path)
      },
    }

    // when
    const acquired = await acquireResearchCampaignOperationLock({
      campaign_directory: campaignDirectory,
      operation_id: "operation-serialized",
    }, runtime)
    expect(acquired.kind).toBe("acquired")
    if (acquired.kind === "error") return
    const released = await releaseResearchCampaignOperationLock({
      campaign_directory: campaignDirectory,
      token: acquired.owner.token,
    }, runtime)

    // then
    expect(released).toEqual({ kind: "ok" })
    expect(acquiredWhileSerialized).toBe(true)
    expect(releasedWhileSerialized).toBe(true)
  })

})
