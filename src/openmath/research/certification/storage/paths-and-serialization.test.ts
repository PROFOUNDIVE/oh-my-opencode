import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import { getResearchCampaignDirectory } from "../../storage"
import { CertificationGenerationIndexV1Schema } from "../state/identity"
import {
  formatCertificationRevisionFilename,
  getCertificationGenerationDirectory,
  getCertificationGenerationIndexPath,
  getCertificationRevisionPath,
  parseCertificationRevisionFilename,
} from "./paths"
import { serializeCertificationGenerationIndex, serializeCertificationRevision } from "./serialization"
import { createCertificationStorageState } from "./storage-test-fixture"

describe("certification sidecar paths and bytes", () => {
  test("derives the exact generation layout and twelve-digit revision filename", () => {
    // given
    const state = createCertificationStorageState("campaign-layout")
    const campaignDirectory = getResearchCampaignDirectory("/tmp/store", state.campaign_id)

    // when
    const generationDirectory = getCertificationGenerationDirectory("/tmp/store", state.campaign_id, state.generation_id)

    // then
    expect(generationDirectory).toBe(join(campaignDirectory, "certification", state.generation_id))
    expect(getCertificationGenerationIndexPath("/tmp/store", state.campaign_id)).toBe(join(campaignDirectory, "certification", "generation-index.json"))
    expect(getCertificationRevisionPath(generationDirectory, 42)).toBe(join(generationDirectory, "certification.rev-000000000042.json"))
    expect(formatCertificationRevisionFilename(42)).toBe("certification.rev-000000000042.json")
    expect(parseCertificationRevisionFilename("certification.rev-000000000042.json")).toBe(42)
    expect(parseCertificationRevisionFilename("campaign.rev-000000000042.json")).toBeNull()
  })

  test("rejects traversal identities instead of constructing paths", () => {
    // when / then
    expect(() => getCertificationGenerationDirectory("/tmp/store", "campaign-a", "../escape")).toThrow()
    expect(() => getCertificationGenerationDirectory("/tmp/store", "campaign-a", "a\\escape")).toThrow()
    expect(() => formatCertificationRevisionFilename(-1)).toThrow(RangeError)
    expect(() => formatCertificationRevisionFilename(1_000_000_000_000)).toThrow(RangeError)
  })

  test("serializes canonical revision and index bytes without whitespace", () => {
    // given
    const state = createCertificationStorageState("campaign-bytes")
    const index = CertificationGenerationIndexV1Schema.parse({
      schema_version: 1,
      campaign_id: state.campaign_id,
      certification_id: state.certification_id,
      generation_id: state.generation_id,
      selected_artifact: state.selected_artifact,
      certification_profile_sha256: state.certification_profile_sha256,
      initialized_from_campaign_revision: 12,
    })

    // when
    const revisionBytes = serializeCertificationRevision(state)
    const indexBytes = serializeCertificationGenerationIndex(index)

    // then
    expect(revisionBytes).toBe(JSON.stringify(state))
    expect(indexBytes).toBe(JSON.stringify(index))
    expect(Object.keys(JSON.parse(indexBytes))).toEqual([
      "schema_version", "campaign_id", "certification_id", "generation_id", "selected_artifact",
      "certification_profile_sha256", "initialized_from_campaign_revision",
    ])
  })
})
