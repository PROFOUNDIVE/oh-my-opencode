import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"

import { nodeStorageRuntime } from "../../../workflow/storage/node-storage-runtime"
import type { StorageRuntime } from "../../../workflow/storage/storage-runtime-contract"
import { getResearchCampaignDirectory } from "../../storage"
import {
  acquireCertificationOperationLock,
  releaseCertificationOperationLock,
} from "./index"
import { initializeCertificationGeneration } from "./initialization-reservation"
import {
  getCertificationGenerationDirectory,
  getCertificationGenerationIndexPath,
  getCertificationRevisionPath,
} from "./paths"
import { writeImmutableCertificationRevision } from "./publication-writers"
import { readCertificationGeneration } from "./reader"
import { repairCertificationGenerationIndex } from "./repair-generation-index"
import { serializeCertificationRevision } from "./serialization"
import { createCertificationStorageState, storageIdentity } from "./storage-test-fixture"

describe("certification crash and campaign lock protocol", () => {
  let directory: string

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "openmath-certification-locking-"))
  })

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  test("leaves a repairable revision orphan when index publication crashes", async () => {
    // given
    const state = createCertificationStorageState("campaign-crash")
    const indexPath = getCertificationGenerationIndexPath(directory, state.campaign_id)
    const runtime: StorageRuntime = {
      ...nodeStorageRuntime,
      link: async (source, destination) => {
        if (destination === indexPath) throw Object.assign(new Error("Injected index publication failure"), { code: "EIO" })
        await nodeStorageRuntime.link(source, destination)
      },
    }

    // when
    const initialized = await initializeCertificationGeneration({ directory, state, initialized_from_campaign_revision: 12 }, runtime)
    const failedStatus = await readCertificationGeneration({ directory, ...storageIdentity(state) })
    const repaired = await repairCertificationGenerationIndex({ directory, ...storageIdentity(state) })

    // then
    expect(initialized).toMatchObject({ kind: "error", error_code: "STORAGE_WRITE_FAILED" })
    expect(failedStatus).toMatchObject({ kind: "error", reason: "REVISION_WITHOUT_INDEX" })
    expect(repaired).toMatchObject({ kind: "ok", state: { certification_revision: 0 } })
  })

  test("publishes revision then index while holding one campaign write lock", async () => {
    // given
    const state = createCertificationStorageState("campaign-order")
    const campaignDirectory = getResearchCampaignDirectory(directory, state.campaign_id)
    const publications: string[] = []
    const runtime: StorageRuntime = {
      ...nodeStorageRuntime,
      link: async (source, destination) => {
        const name = basename(destination)
        if (name.startsWith("certification.rev-") || name === "generation-index.json") {
          expect(existsSync(join(campaignDirectory, ".write.lock"))).toBe(true)
          publications.push(name)
        }
        await nodeStorageRuntime.link(source, destination)
      },
    }

    // when
    const result = await initializeCertificationGeneration({ directory, state, initialized_from_campaign_revision: 12 }, runtime)

    // then
    expect(result.kind).toBe("ok")
    expect(publications).toEqual(["certification.rev-000000000000.json", "generation-index.json"])
    expect(existsSync(join(campaignDirectory, ".write.lock"))).toBe(false)
  })

  test("returns a typed durability failure and leaves no index when revision directory fsync fails", async () => {
    // given
    const state = createCertificationStorageState("campaign-fsync")
    const generationDirectory = getCertificationGenerationDirectory(directory, state.campaign_id, state.generation_id)
    const runtime: StorageRuntime = {
      ...nodeStorageRuntime,
      open: async (path, flags) => {
        const handle = await nodeStorageRuntime.open(path, flags)
        return flags === "r" && path === generationDirectory
          ? { ...handle, sync: async () => { throw new Error("Injected directory fsync failure") } }
          : handle
      },
    }

    // when
    const result = await initializeCertificationGeneration({ directory, state, initialized_from_campaign_revision: 12 }, runtime)
    const status = await readCertificationGeneration({ directory, ...storageIdentity(state) })

    // then
    expect(result).toMatchObject({ kind: "error", error_code: "STORAGE_WRITE_FAILED" })
    expect(status).toMatchObject({ kind: "error", reason: "REVISION_WITHOUT_INDEX" })
    expect(existsSync(getCertificationGenerationIndexPath(directory, state.campaign_id))).toBe(false)
  })

  test("returns a typed failure when generation directory creation fails", async () => {
    // given
    const state = createCertificationStorageState("campaign-mkdir-failure")
    const generationDirectory = getCertificationGenerationDirectory(directory, state.campaign_id, state.generation_id)
    const runtime: StorageRuntime = {
      ...nodeStorageRuntime,
      mkdir: async (path) => {
        if (path === generationDirectory) throw Object.assign(new Error("Injected mkdir failure"), { code: "EIO" })
        await nodeStorageRuntime.mkdir(path)
      },
    }

    // when
    const result = await initializeCertificationGeneration({ directory, state, initialized_from_campaign_revision: 12 }, runtime)

    // then
    expect(result).toMatchObject({ kind: "error", error_code: "STORAGE_WRITE_FAILED" })
  })

  test("keeps operation ownership while sidecar publication takes a transient write lock", async () => {
    // given
    const state = createCertificationStorageState("campaign-operation")
    const campaignDirectory = getResearchCampaignDirectory(directory, state.campaign_id)
    await nodeStorageRuntime.mkdir(campaignDirectory)
    const owner = await acquireCertificationOperationLock({ directory, campaign_id: state.campaign_id, operation_id: "certification-step-1" })
    if (owner.kind === "error") throw new TypeError(owner.message)

    // when
    const initialized = await initializeCertificationGeneration({ directory, state, initialized_from_campaign_revision: 12 })
    const released = await releaseCertificationOperationLock({ directory, campaign_id: state.campaign_id, token: owner.owner.token })

    // then
    expect(initialized.kind).toBe("ok")
    expect(released).toEqual({ kind: "ok" })
    expect(existsSync(join(campaignDirectory, ".operation.lock"))).toBe(false)
  })

  test("never replaces an allocated revision with different bytes", async () => {
    // given
    const state = createCertificationStorageState("campaign-no-replace")
    await initializeCertificationGeneration({ directory, state, initialized_from_campaign_revision: 12 })
    const generationDirectory = getCertificationGenerationDirectory(directory, state.campaign_id, state.generation_id)
    const revisionPath = getCertificationRevisionPath(generationDirectory, 0)
    const original = readFileSync(revisionPath, "utf8")

    // when
    const result = await writeImmutableCertificationRevision({
      directory,
      campaign_id: state.campaign_id,
      generation_id: state.generation_id,
      revision: 0,
      serialized_bytes: serializeCertificationRevision(state).replace("READY", "BLOCKED"),
    })

    // then
    expect(result).toMatchObject({ kind: "error", error_code: "STORAGE_WRITE_FAILED" })
    expect(readFileSync(revisionPath, "utf8")).toBe(original)
  })
})
