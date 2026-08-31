import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { reduceCertificationTransition } from "../transitions"
import { compareAndSwapCertificationGeneration } from "./compare-and-swap"
import { initializeCertificationGeneration } from "./initialization-reservation"
import { getCertificationGenerationDirectory, getCertificationRevisionPath } from "./paths"
import { readCertificationGeneration } from "./reader"
import { createCertificationStorageState, storageIdentity } from "./storage-test-fixture"

describe("certification storage byte decoding", () => {
  let directory: string

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "openmath-certification-bytes-"))
  })

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  test("rejects invalid UTF-8 in the highest immutable revision", async () => {
    // given
    const ready = createCertificationStorageState("campaign-invalid-utf8")
    const transition = reduceCertificationTransition(ready, { type: "ABORT", reason: "raw-byte" }, 0)
    if (!transition.ok) throw new TypeError(transition.message)
    await initializeCertificationGeneration({ directory, state: ready, initialized_from_campaign_revision: 12 })
    const committed = await compareAndSwapCertificationGeneration({
      directory,
      identity: storageIdentity(ready),
      expected_certification_revision: 0,
      next_state: transition.state,
    })
    if (committed.kind === "error") throw new TypeError(committed.message)
    const generationDirectory = getCertificationGenerationDirectory(directory, ready.campaign_id, ready.generation_id)
    const revisionPath = getCertificationRevisionPath(generationDirectory, 1)
    const bytes = readFileSync(revisionPath)
    const markerOffset = bytes.indexOf("raw-byte")
    if (markerOffset < 0) throw new TypeError("Expected abort reason marker")
    bytes[markerOffset] = 0xff
    writeFileSync(revisionPath, bytes)

    // when
    const result = await readCertificationGeneration({ directory, ...storageIdentity(ready) })

    // then
    expect(result).toMatchObject({ kind: "error", error_code: "STORAGE_READ_FAILED", reason: "UNREADABLE_REVISION" })
  })
})
