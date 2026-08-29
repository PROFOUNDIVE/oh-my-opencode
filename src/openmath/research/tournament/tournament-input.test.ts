import { describe, expect, test } from "bun:test"

import { CandidateIdSchema, type ScreenNormalizedOutput } from "../state"
import { buildTournamentSession } from "./tournament-input"

const SCREEN: ScreenNormalizedOutput = {
  verdict: "VIABLE",
  blocking_issues: ["Repair edge case."],
  unresolved_obligations: ["Close the final lemma."],
  assumptions: ["Finite setting."],
  novel_elements: ["New reduction."],
}

describe("tournament model input", () => {
  test("uses stable creation-order labels with only artifact content and normalized screens", () => {
    // given
    const candidates = [
      candidate("secret-direct-01", "DIRECT_ARTIFACT"),
      candidate("secret-construction-01", "CONSTRUCTION_ARTIFACT"),
    ]

    // when
    const session = buildTournamentSession(candidates)

    // then
    expect(session.label_mapping).toEqual([
      { label: "entry-001", candidate_id: "secret-direct-01" },
      { label: "entry-002", candidate_id: "secret-construction-01" },
    ])
    expect(session.payload).toEqual({ candidates: [
      { label: "entry-001", artifact: { content: "DIRECT_ARTIFACT" }, screen_summaries: [SCREEN] },
      { label: "entry-002", artifact: { content: "CONSTRUCTION_ARTIFACT" }, screen_summaries: [SCREEN] },
    ] })
  })

  test("serializes no candidate identity, lineage, provenance, hash, or sibling metadata", () => {
    // given
    const input = [{
      ...candidate("secret-direct-01", "DIRECT_ARTIFACT"),
      parent_candidate_ids: ["PARENT_ID_SENTINEL"],
      strategy_id: "STRATEGY_SENTINEL",
      child_run_id: "CHILD_RUN_SENTINEL",
      providerID: "PROVIDER_SENTINEL",
      modelID: "MODEL_SENTINEL",
      session_id: "SESSION_SENTINEL",
      sha256: "HASH_SENTINEL",
      sibling_artifact: "SIBLING_SENTINEL",
    }]

    // when
    const serialized = JSON.stringify(buildTournamentSession(input).payload)

    // then
    for (const sentinel of [
      "secret-direct-01", "PARENT_ID_SENTINEL", "STRATEGY_SENTINEL", "CHILD_RUN_SENTINEL",
      "PROVIDER_SENTINEL", "MODEL_SENTINEL", "SESSION_SENTINEL", "HASH_SENTINEL", "SIBLING_SENTINEL",
    ]) expect(serialized).not.toContain(sentinel)
  })
})

function candidate(candidateId: string, artifactContent: string) {
  return {
    candidate_id: CandidateIdSchema.parse(candidateId),
    artifact_content: artifactContent,
    screen_summaries: [SCREEN],
  }
}
