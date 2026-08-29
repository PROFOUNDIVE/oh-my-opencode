import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { z } from "zod"

import { nodeStorageRuntime } from "../../workflow/storage/node-storage-runtime"
import type { StorageRuntime } from "../../workflow/storage/storage-runtime-contract"
import {
  acquireResearchCampaignOperationLock,
  readResearchCampaignOperationLock,
  releaseResearchCampaignOperationLock,
} from "./operation-lock"

const OperationRecordSchema = z.object({
  token: z.string(),
  pid: z.number().int().positive(),
  operation_id: z.string(),
  started_at: z.iso.datetime({ offset: true }),
}).strict()

describe("research campaign operation ownership", () => {
  let campaignDirectory: string

  beforeEach(() => {
    campaignDirectory = mkdtempSync(join(tmpdir(), "openmath-research-operation-lock-"))
  })

  afterEach(() => {
    rmSync(campaignDirectory, { recursive: true, force: true })
  })

  test("persists token, PID, operation ID, and start time", async () => {
    // when
    const result = await acquireResearchCampaignOperationLock({
      campaign_directory: campaignDirectory,
      operation_id: "operation-1",
    })

    // then
    expect(result).toMatchObject({
      kind: "acquired",
      owner: { pid: process.pid, operation_id: "operation-1" },
      recovered_owner: null,
    })
    if (result.kind === "error") return
    const persisted = OperationRecordSchema.parse(JSON.parse(readFileSync(join(campaignDirectory, ".operation.lock"), "utf8")))
    expect(persisted).toEqual(result.owner)
  })

  test("gives one concurrent research step ownership and rejects the other", async () => {
    // when
    const results = await Promise.all([
      acquireResearchCampaignOperationLock({ campaign_directory: campaignDirectory, operation_id: "operation-1" }),
      acquireResearchCampaignOperationLock({ campaign_directory: campaignDirectory, operation_id: "operation-1" }),
    ])

    // then
    expect(results.map((result) => result.kind).sort()).toEqual(["acquired", "error"])
    expect(results.find((result) => result.kind === "error")).toMatchObject({ error_code: "STORAGE_BUSY" })
  })

  test("never steals an operation lock from a live owner", async () => {
    // given
    const first = await acquireResearchCampaignOperationLock({
      campaign_directory: campaignDirectory,
      operation_id: "operation-live",
    })
    expect(first.kind).toBe("acquired")
    const lockPath = join(campaignDirectory, ".operation.lock")
    const originalBytes = readFileSync(lockPath, "utf8")

    // when
    const second = await acquireResearchCampaignOperationLock({
      campaign_directory: campaignDirectory,
      operation_id: "operation-live",
    })

    // then
    expect(second).toMatchObject({ kind: "error", error_code: "STORAGE_BUSY" })
    expect(readFileSync(lockPath, "utf8")).toBe(originalBytes)
  })

  test("recovers the same recorded operation only after its owner PID is dead", async () => {
    // given
    const lockPath = join(campaignDirectory, ".operation.lock")
    const deadOwner = {
      token: "dead-owner",
      pid: 2_147_483_647,
      operation_id: "operation-recover",
      started_at: "2026-08-28T12:00:00.000Z",
    }
    writeFileSync(lockPath, JSON.stringify(deadOwner))
    const runtime: StorageRuntime = { ...nodeStorageRuntime, processStatus: () => "dead", token: () => "new-owner" }

    // when
    const recovered = await acquireResearchCampaignOperationLock({
      campaign_directory: campaignDirectory,
      operation_id: "operation-recover",
    }, runtime)

    // then
    expect(recovered).toMatchObject({
      kind: "acquired",
      owner: { token: "new-owner", operation_id: "operation-recover" },
      recovered_owner: deadOwner,
    })
    expect(OperationRecordSchema.parse(JSON.parse(readFileSync(lockPath, "utf8")))).toMatchObject({
      token: "new-owner",
      operation_id: "operation-recover",
    })
  })

  test("does not replace a dead owner with a different operation", async () => {
    // given
    const lockPath = join(campaignDirectory, ".operation.lock")
    const deadOwner = {
      token: "dead-owner",
      pid: 2_147_483_647,
      operation_id: "operation-recorded",
      started_at: "2026-08-28T12:00:00.000Z",
    }
    writeFileSync(lockPath, JSON.stringify(deadOwner))
    const runtime: StorageRuntime = { ...nodeStorageRuntime, processStatus: () => "dead" }

    // when
    const result = await acquireResearchCampaignOperationLock({
      campaign_directory: campaignDirectory,
      operation_id: "operation-different",
    }, runtime)

    // then
    expect(result).toMatchObject({ kind: "error", error_code: "STORAGE_BUSY" })
    expect(OperationRecordSchema.parse(JSON.parse(readFileSync(lockPath, "utf8")))).toEqual(deadOwner)
  })

  test("allows only the owning token to release and leaves no lock after owner cleanup", async () => {
    // given
    const acquired = await acquireResearchCampaignOperationLock({
      campaign_directory: campaignDirectory,
      operation_id: "operation-release",
    })
    expect(acquired.kind).toBe("acquired")
    if (acquired.kind === "error") return
    const lockPath = join(campaignDirectory, ".operation.lock")

    // when
    const rejected = await releaseResearchCampaignOperationLock({
      campaign_directory: campaignDirectory,
      token: "different-token",
    })
    const inspected = await readResearchCampaignOperationLock(campaignDirectory)
    const released = await releaseResearchCampaignOperationLock({
      campaign_directory: campaignDirectory,
      token: acquired.owner.token,
    })

    // then
    expect(rejected).toMatchObject({ kind: "error", error_code: "STORAGE_BUSY" })
    expect(inspected).toMatchObject({ kind: "owned", owner: acquired.owner, process_status: "live" })
    expect(released).toEqual({ kind: "ok" })
    expect(existsSync(lockPath)).toBe(false)
  })
})
