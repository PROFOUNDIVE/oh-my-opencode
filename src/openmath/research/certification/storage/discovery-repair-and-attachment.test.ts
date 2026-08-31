import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { sha256 } from "../../../workflow/stage-runner/sha256"
import { initializeCertificationGeneration } from "./initialization-reservation"
import {
  getCertificationGenerationDirectory,
  getCertificationGenerationIndexPath,
  getCertificationRevisionPath,
  getCertificationStorageRef,
} from "./paths"
import { readCertificationAttachment, readCertificationGeneration } from "./reader"
import { repairCertificationGenerationIndex } from "./repair-generation-index"
import { serializeCertificationRevision } from "./serialization"
import { createCertificationStorageState, storageIdentity } from "./storage-test-fixture"

describe("certification discovery and explicit repair", () => {
  let directory: string

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "openmath-certification-discovery-"))
  })

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  test("reports NOT_STARTED only when index and revisions are both absent", async () => {
    // given
    const state = createCertificationStorageState("campaign-not-started")

    // when
    const result = await readCertificationGeneration({ directory, ...storageIdentity(state) })

    // then
    expect(result).toEqual({ kind: "not_started" })
  })

  test("keeps revision-only status failed until explicit validated index repair", async () => {
    // given
    const state = createCertificationStorageState("campaign-orphan")
    const generationDirectory = getCertificationGenerationDirectory(directory, state.campaign_id, state.generation_id)
    mkdirSync(generationDirectory, { recursive: true })
    writeFileSync(getCertificationRevisionPath(generationDirectory, 0), serializeCertificationRevision(state))

    // when
    const before = await readCertificationGeneration({ directory, ...storageIdentity(state) })
    const repaired = await repairCertificationGenerationIndex({ directory, ...storageIdentity(state) })
    const after = await readCertificationGeneration({ directory, ...storageIdentity(state) })

    // then
    expect(before).toMatchObject({ kind: "error", error_code: "STORAGE_READ_FAILED", reason: "REVISION_WITHOUT_INDEX" })
    expect(repaired).toMatchObject({ kind: "ok", state: { certification_revision: 0 } })
    expect(after).toMatchObject({ kind: "ok", state: { certification_revision: 0 } })
  })

  test("fails closed for index-only and corrupt-highest stores without fallback", async () => {
    // given
    const state = createCertificationStorageState("campaign-fail-closed")
    await initializeCertificationGeneration({ directory, state, initialized_from_campaign_revision: 12 })
    const generationDirectory = getCertificationGenerationDirectory(directory, state.campaign_id, state.generation_id)
    const revisionZeroPath = getCertificationRevisionPath(generationDirectory, 0)
    unlinkSync(revisionZeroPath)

    // when
    const indexOnly = await readCertificationGeneration({ directory, ...storageIdentity(state) })
    writeFileSync(revisionZeroPath, serializeCertificationRevision(state))
    writeFileSync(getCertificationRevisionPath(generationDirectory, 1), "{corrupt")
    const corruptHighest = await readCertificationGeneration({ directory, ...storageIdentity(state) })

    // then
    expect(indexOnly).toMatchObject({ kind: "error", error_code: "STORAGE_READ_FAILED" })
    expect(corruptHighest).toMatchObject({ kind: "error", error_code: "STORAGE_READ_FAILED" })
  })

  test("rejects index identity swaps and attachment external hash mismatches", async () => {
    // given
    const state = createCertificationStorageState("campaign-hash-check")
    await initializeCertificationGeneration({ directory, state, initialized_from_campaign_revision: 12 })
    const generationDirectory = getCertificationGenerationDirectory(directory, state.campaign_id, state.generation_id)
    const bytes = readFileSync(getCertificationRevisionPath(generationDirectory, 0), "utf8")

    // when
    const mismatch = await readCertificationAttachment({
      directory,
      campaign_id: state.campaign_id,
      generation_id: state.generation_id,
      selected_artifact: state.selected_artifact,
      certification_profile_sha256: state.certification_profile_sha256,
      initialized_from_campaign_revision: 12,
      certification_revision: 0,
      expected_content_sha256: "f".repeat(64),
      storage_ref: getCertificationStorageRef(state.generation_id, 0),
    })
    const matching = await readCertificationAttachment({
      directory,
      campaign_id: state.campaign_id,
      generation_id: state.generation_id,
      selected_artifact: state.selected_artifact,
      certification_profile_sha256: state.certification_profile_sha256,
      initialized_from_campaign_revision: 12,
      certification_revision: 0,
      expected_content_sha256: sha256(bytes),
      storage_ref: getCertificationStorageRef(state.generation_id, 0),
    })
    const substitutedPath = await readCertificationAttachment({
      directory,
      campaign_id: state.campaign_id,
      generation_id: state.generation_id,
      selected_artifact: state.selected_artifact,
      certification_profile_sha256: state.certification_profile_sha256,
      initialized_from_campaign_revision: 12,
      certification_revision: 0,
      expected_content_sha256: sha256(bytes),
      storage_ref: "../../campaign.rev-000000000000.json",
    })
    const indexPath = getCertificationGenerationIndexPath(directory, state.campaign_id)
    const index = JSON.parse(readFileSync(indexPath, "utf8"))
    writeFileSync(indexPath, JSON.stringify({ ...index, campaign_id: "campaign-swapped" }))
    const swapped = await readCertificationGeneration({ directory, ...storageIdentity(state) })

    // then
    expect(mismatch).toMatchObject({ kind: "error", error_code: "CONTENT_HASH_MISMATCH" })
    expect(matching).toMatchObject({ kind: "ok", content_sha256: sha256(bytes) })
    expect(substitutedPath).toMatchObject({ kind: "error", error_code: "STORAGE_READ_FAILED" })
    expect(swapped).toMatchObject({ kind: "error", error_code: "STORAGE_READ_FAILED" })
  })

  test("rejects artifact and profile identity substitutions", async () => {
    // given
    const state = createCertificationStorageState("campaign-identity-check")
    await initializeCertificationGeneration({ directory, state, initialized_from_campaign_revision: 12 })

    // when
    const wrongArtifact = await readCertificationGeneration({
      directory,
      ...storageIdentity(state),
      selected_artifact: { ...state.selected_artifact, artifact_sha256: "e".repeat(64) },
    })
    const wrongProfile = await readCertificationGeneration({
      directory,
      ...storageIdentity(state),
      certification_profile_sha256: "d".repeat(64),
    })

    // then
    expect(wrongArtifact).toMatchObject({ kind: "error", error_code: "STORAGE_READ_FAILED", reason: "INVALID_IDENTITY" })
    expect(wrongProfile).toMatchObject({ kind: "error", error_code: "STORAGE_READ_FAILED", reason: "INVALID_IDENTITY" })
  })

  test("fails attachment reads when the immutable generation index is missing", async () => {
    // given
    const state = createCertificationStorageState("campaign-attachment-index")
    await initializeCertificationGeneration({ directory, state, initialized_from_campaign_revision: 12 })
    const generationDirectory = getCertificationGenerationDirectory(directory, state.campaign_id, state.generation_id)
    const bytes = readFileSync(getCertificationRevisionPath(generationDirectory, 0), "utf8")
    unlinkSync(getCertificationGenerationIndexPath(directory, state.campaign_id))

    // when
    const result = await readCertificationAttachment({
      directory,
      campaign_id: state.campaign_id,
      generation_id: state.generation_id,
      selected_artifact: state.selected_artifact,
      certification_profile_sha256: state.certification_profile_sha256,
      initialized_from_campaign_revision: 12,
      certification_revision: 0,
      expected_content_sha256: sha256(bytes),
      storage_ref: getCertificationStorageRef(state.generation_id, 0),
    })

    // then
    expect(result).toMatchObject({ kind: "error", error_code: "STORAGE_READ_FAILED" })
  })

})
