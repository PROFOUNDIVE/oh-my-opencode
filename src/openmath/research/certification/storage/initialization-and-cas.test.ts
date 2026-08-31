import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { getResearchCampaignDirectory } from "../../storage"
import { sha256 } from "../../../workflow/stage-runner/sha256"
import { ResearchCertificationStateV1Schema } from "../state/schema"
import { compareAndSwapCertificationGeneration } from "./compare-and-swap"
import { initializeCertificationGeneration } from "./initialization-reservation"
import { getCertificationGenerationIndexPath, getCertificationRevisionPath } from "./paths"
import { readCertificationGeneration } from "./reader"
import { createCertificationStorageState, storageIdentity } from "./storage-test-fixture"

describe("certification sidecar publication", () => {
  let directory: string

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "openmath-certification-storage-"))
  })

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  test("initializes revision zero then the immutable index and survives restart", async () => {
    // given
    const state = createCertificationStorageState("campaign-initialize")

    // when
    const initialized = await initializeCertificationGeneration({ directory, state, initialized_from_campaign_revision: 12 })
    const restarted = await readCertificationGeneration({ directory, ...storageIdentity(state) })

    // then
    expect(initialized).toMatchObject({ kind: "ok", state: { certification_revision: 0 } })
    expect(restarted).toMatchObject({ kind: "ok", state: { certification_id: state.certification_id, certification_revision: 0 } })
    if (restarted.kind !== "ok") throw new TypeError("Expected readable certification generation")
    const generationDirectory = join(getResearchCampaignDirectory(directory, state.campaign_id), "certification", state.generation_id)
    expect(restarted.content_sha256).toBe(sha256(readFileSync(getCertificationRevisionPath(generationDirectory, 0), "utf8")))
    expect(restarted.index_content_sha256).toBe(sha256(readFileSync(getCertificationGenerationIndexPath(directory, state.campaign_id), "utf8")))
  })

  test("allows one concurrent initialization identity and preserves immutable bytes", async () => {
    // given
    const state = createCertificationStorageState("campaign-init-race")

    // when
    const results = await Promise.all([
      initializeCertificationGeneration({ directory, state, initialized_from_campaign_revision: 12 }),
      initializeCertificationGeneration({ directory, state, initialized_from_campaign_revision: 12 }),
    ])

    // then
    expect(results.map((result) => result.kind).sort()).toEqual(["error", "ok"])
    expect(results.find((result) => result.kind === "error")).toMatchObject({ error_code: "CERTIFICATION_ALREADY_EXISTS" })
    const indexPath = getCertificationGenerationIndexPath(directory, state.campaign_id)
    expect(JSON.parse(readFileSync(indexPath, "utf8"))).toMatchObject({ generation_id: state.generation_id })
  })

  test("reserves exactly one generation when concurrent identities differ", async () => {
    // given
    const first = createCertificationStorageState("campaign-identity-race", "1".repeat(64))
    const second = createCertificationStorageState("campaign-identity-race", "3".repeat(64))

    // when
    const results = await Promise.all([
      initializeCertificationGeneration({ directory, state: first, initialized_from_campaign_revision: 12 }),
      initializeCertificationGeneration({ directory, state: second, initialized_from_campaign_revision: 12 }),
    ])
    const index = JSON.parse(readFileSync(getCertificationGenerationIndexPath(directory, first.campaign_id), "utf8"))

    // then
    expect(results.filter((result) => result.kind === "ok")).toHaveLength(1)
    expect([first.generation_id, second.generation_id]).toContain(index.generation_id)
    expect(results.find((result) => result.kind === "error")).toMatchObject({ error_code: "STORAGE_READ_FAILED" })
  })

  test("admits one expected-revision CAS and leaves failed compare immutable", async () => {
    // given
    const state = createCertificationStorageState("campaign-cas")
    await initializeCertificationGeneration({ directory, state, initialized_from_campaign_revision: 12 })
    const generationDirectory = join(getResearchCampaignDirectory(directory, state.campaign_id), "certification", state.generation_id)
    const revisionZeroPath = getCertificationRevisionPath(generationDirectory, 0)
    const revisionZeroBytes = readFileSync(revisionZeroPath, "utf8")

    // when
    const results = await Promise.all([
      compareAndSwapCertificationGeneration({ directory, identity: storageIdentity(state), expected_certification_revision: 0, next_state: state }),
      compareAndSwapCertificationGeneration({ directory, identity: storageIdentity(state), expected_certification_revision: 0, next_state: state }),
    ])

    // then
    expect(results.map((result) => result.kind).sort()).toEqual(["error", "ok"])
    expect(results.find((result) => result.kind === "error")).toMatchObject({ error_code: "STALE_CERTIFICATION_REVISION", current_certification_revision: 1 })
    expect(readFileSync(revisionZeroPath, "utf8")).toBe(revisionZeroBytes)
    expect(existsSync(getCertificationRevisionPath(generationDirectory, 2))).toBe(false)
  })

  test("rejects immutable state identity changes without allocating a revision", async () => {
    // given
    const state = createCertificationStorageState("campaign-cas-identity")
    await initializeCertificationGeneration({ directory, state, initialized_from_campaign_revision: 12 })
    const generationDirectory = join(getResearchCampaignDirectory(directory, state.campaign_id), "certification", state.generation_id)

    // when
    const result = await compareAndSwapCertificationGeneration({
      directory,
      identity: storageIdentity(state),
      expected_certification_revision: 0,
      next_state: ResearchCertificationStateV1Schema.parse({ ...state, profile_sha256: "a".repeat(64) }),
    })

    // then
    expect(result).toMatchObject({ kind: "error", error_code: "STORAGE_WRITE_FAILED" })
    expect(existsSync(getCertificationRevisionPath(generationDirectory, 1))).toBe(false)
  })

  test("returns a typed error for an invalid initialization campaign revision", async () => {
    // given
    const state = createCertificationStorageState("campaign-invalid-revision")

    // when
    const result = await initializeCertificationGeneration({ directory, state, initialized_from_campaign_revision: -1 })

    // then
    expect(result).toMatchObject({ kind: "error", error_code: "STORAGE_WRITE_FAILED" })
  })
})
