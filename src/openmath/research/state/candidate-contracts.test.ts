import { describe, expect, test } from "bun:test"

import { sha256 } from "../../workflow/stage-runner/sha256"
import {
  CandidateArtifactReferenceSchema,
  CandidateDescriptorSchema,
  ResearchCampaignSourceSnapshotSchema,
} from "./index"

const HASH_A = "a".repeat(64)
const HASH_B = "b".repeat(64)

describe("research campaign immutable source snapshots", () => {
  test("parses and freezes the objective, profile, and reference snapshot bytes", () => {
    // given
    const input = {
      objective: {
        request: { kind: "markdown", instruction: "Prove the conjecture." },
        sha256: HASH_A,
      },
      profile: {
        schema_version: 1,
        name: "phase-a-profile",
        serialized_bytes: "{\"name\":\"phase-a-profile\"}",
        sha256: HASH_B,
      },
      references: {
        schema_version: 1,
        serialized_bytes: "{\"references\":[]}",
        sha256: HASH_A,
      },
    }

    // when
    const parsed = ResearchCampaignSourceSnapshotSchema.parse(input)

    // then
    expect(parsed).toEqual(input)
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed.objective)).toBe(true)
    expect(Object.isFrozen(parsed.profile)).toBe(true)
    expect(Object.isFrozen(parsed.references)).toBe(true)
  })
})

describe("candidate descriptors and artifact references", () => {
  test("binds an immutable artifact to a child workflow revision", () => {
    // given
    const input = artifact("campaign-1::direct-01")

    // when
    const parsed = CandidateArtifactReferenceSchema.parse(input)

    // then
    expect(parsed).toEqual(input)
    expect(Object.isFrozen(parsed)).toBe(true)
  })

  test("models initial strategy candidates with empty lineage and attachment defaults", () => {
    // given
    const input = {
      candidate_kind: "STRATEGY",
      candidate_id: "direct-01",
      strategy_id: "direct-proof",
      strategy_ordinal: 1,
      created_at_revision: 0,
      child_run_id: "campaign-1::direct-01",
      child_state_revision: 2,
      artifact: artifact("campaign-1::direct-01"),
      parent_candidate_ids: [],
    }

    // when
    const parsed = CandidateDescriptorSchema.parse(input)

    // then
    expect(parsed.attachments).toEqual([])
    expect(parsed.parent_candidate_ids).toEqual([])
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed.attachments)).toBe(true)
  })

  test("models merge candidates only with two or more parents and a hash-bound synthesis brief", () => {
    // given
    const synthesisBrief = "Preserve the reduction and use the construction."
    const valid = {
      candidate_kind: "MERGE_IDEA",
      candidate_id: "merged-01",
      created_at_revision: 8,
      child_run_id: "campaign-1::merged-01",
      child_state_revision: null,
      artifact: null,
      parent_candidate_ids: ["direct-01", "construction-01"],
      synthesis_brief: synthesisBrief,
      synthesis_brief_sha256: sha256(synthesisBrief),
    }
    const oneParent = { ...valid, parent_candidate_ids: ["direct-01"] }
    const wrongHash = { ...valid, synthesis_brief_sha256: HASH_B }

    // when
    const parsed = CandidateDescriptorSchema.safeParse(valid)
    const rejected = [oneParent, wrongHash].map((candidate) => CandidateDescriptorSchema.safeParse(candidate))

    // then
    expect(parsed.success).toBe(true)
    expect(rejected.every((result) => !result.success)).toBe(true)
  })
})

function artifact(childRunId: string) {
  return {
    child_run_id: childRunId,
    child_state_revision: 2,
    artifact_version: 1,
    media_type: "text/markdown",
    sha256: HASH_A,
  }
}
