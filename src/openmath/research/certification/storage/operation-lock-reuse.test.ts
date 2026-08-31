import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { z } from "zod"

import { nodeStorageRuntime } from "../../../workflow/storage/node-storage-runtime"
import type { StorageRuntime } from "../../../workflow/storage/storage-runtime-contract"
import { getResearchCampaignDirectory } from "../../storage/campaign-directory-hash"
import {
  acquireCertificationOperationLock,
  readCertificationOperationLock,
  releaseCertificationOperationLock,
} from "./index"

const OwnerSchema = z.object({
  token: z.string(),
  pid: z.number().int().positive(),
  operation_id: z.string(),
  started_at: z.iso.datetime({ offset: true }),
}).strict()

describe("certification dispatch operation lock reuse", () => {
  const campaignId = "certification-operation"
  let directory: string
  let campaignDirectory: string

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "openmath-certification-operation-"))
    campaignDirectory = getResearchCampaignDirectory(directory, campaignId)
    mkdirSync(campaignDirectory, { recursive: true })
  })

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  test("rejects traversal identity before deriving an operation-lock path", async () => {
    // when
    const result = await acquireCertificationOperationLock({
      directory,
      campaign_id: "../escape",
      operation_id: "certification-step-invalid",
    })

    // then
    expect(result).toMatchObject({ kind: "error", error_code: "STORAGE_WRITE_FAILED" })
  })

  test("rejects a second live dispatch owner without stealing its record", async () => {
    // given
    const first = await acquireCertificationOperationLock({ directory, campaign_id: campaignId, operation_id: "certification-step-live" })
    if (first.kind === "error") throw new TypeError(first.message)
    const original = readFileSync(join(campaignDirectory, ".operation.lock"), "utf8")

    // when
    const second = await acquireCertificationOperationLock({ directory, campaign_id: campaignId, operation_id: "certification-step-live" })
    const inspected = await readCertificationOperationLock({ directory, campaign_id: campaignId })

    // then
    expect(second).toMatchObject({ kind: "error", error_code: "STORAGE_BUSY" })
    expect(inspected).toMatchObject({ kind: "owned", owner: first.owner, process_status: "live" })
    expect(readFileSync(join(campaignDirectory, ".operation.lock"), "utf8")).toBe(original)
  })

  test("recovers only the same operation after its recorded owner is dead", async () => {
    // given
    const deadOwner = {
      token: "dead-certification-owner",
      pid: 2_147_483_647,
      operation_id: "certification-step-recover",
      started_at: "2026-08-30T12:00:00.000Z",
    }
    writeFileSync(join(campaignDirectory, ".operation.lock"), JSON.stringify(deadOwner))
    const runtime: StorageRuntime = {
      ...nodeStorageRuntime,
      processStatus: () => "dead",
      token: () => "recovered-certification-owner",
    }

    // when
    const recovered = await acquireCertificationOperationLock({
      directory,
      campaign_id: campaignId,
      operation_id: "certification-step-recover",
    }, runtime)

    // then
    expect(recovered).toMatchObject({ kind: "acquired", recovered_owner: deadOwner })
    expect(OwnerSchema.parse(JSON.parse(readFileSync(join(campaignDirectory, ".operation.lock"), "utf8")))).toMatchObject({
      token: "recovered-certification-owner",
      operation_id: "certification-step-recover",
    })
  })

  test("requires the owning token on release", async () => {
    // given
    const acquired = await acquireCertificationOperationLock({ directory, campaign_id: campaignId, operation_id: "certification-step-release" })
    if (acquired.kind === "error") throw new TypeError(acquired.message)

    // when
    const rejected = await releaseCertificationOperationLock({ directory, campaign_id: campaignId, token: "other-owner" })
    const released = await releaseCertificationOperationLock({ directory, campaign_id: campaignId, token: acquired.owner.token })

    // then
    expect(rejected).toMatchObject({ kind: "error", error_code: "STORAGE_BUSY" })
    expect(released).toEqual({ kind: "ok" })
  })
})
