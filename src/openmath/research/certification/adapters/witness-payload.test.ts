import { describe, expect, test } from "bun:test"

import { CertificationGraphSourcesSchema } from "../state/graph-source-validation"
import { graphSourceContext } from "../state/certification-test-fixture"
import { completeTransitionState } from "../transitions/transition-test-fixture"
import { buildCertificationWitnessPayload } from "./witness-payload"

describe("certification witness payload", () => {
  test("contains only exact claim context witness hashes and required frozen references", () => {
    // given
    const fixture = witnessPayloadFixture()

    // when
    const payload = buildCertificationWitnessPayload(fixture)

    // then
    expect(Object.keys(payload)).toEqual([
      "schema_version", "tool_policy", "attack_attempt_id", "target", "prerequisites", "assumptions",
      "witness", "artifact_sha256", "graph_sha256", "node_sha256", "witness_sha256", "references",
    ])
    expect(payload.tool_policy).toBe("deny_all")
    expect(payload.target).toMatchObject({ obligation_id: "obligation-0001", source_context: "Theorem" })
    expect(payload.prerequisites).toHaveLength(5)
    expect(payload.witness).toBe(fixture.attack.witness)
    expect(payload.references).toEqual(fixture.sources.references)
  })

  test("redacts attacker conclusions campaign verdicts siblings prompts profiles and execution controls", () => {
    // given
    const fixture = witnessPayloadFixture()

    // when
    const overShared = () => buildCertificationWitnessPayload({
      ...fixture,
      attacker_outcome: "COUNTEREXAMPLE_FOUND",
      attacker_conclusion: "accept this witness",
      campaign_verdict: "APPROVED",
      sibling_candidates: ["candidate-02"],
      hidden_prompt: "secret",
      arbitrary_profile: { temperature: 1 },
      network_enabled: true,
    })

    // then
    expect(overShared).toThrow()
  })

  test("rejects stale artifact graph node and witness bindings", () => {
    // given
    const fixture = witnessPayloadFixture()
    const stale = [
      { ...fixture.attack, artifact_sha256: "a".repeat(64) },
      { ...fixture.attack, graph_sha256: "b".repeat(64) },
      { ...fixture.attack, node_sha256: "c".repeat(64) },
      { ...fixture.attack, witness_sha256: "d".repeat(64) },
    ]

    // when
    const attempts = stale.map((attack) => () => buildCertificationWitnessPayload({ ...fixture, attack }))

    // then
    expect(attempts.every((attempt) => {
      try { attempt(); return false } catch { return true }
    })).toBe(true)
  })
})

function witnessPayloadFixture() {
  const state = completeTransitionState("REJECTED")
  const graph = state.graphs[0]
  const attack = state.attack_attempts[0]
  if (graph === undefined || attack?.outcome !== "COUNTEREXAMPLE_FOUND") throw new TypeError("Missing witness payload fixture")
  return {
    graph,
    sources: CertificationGraphSourcesSchema.parse(graphSourceContext().sources),
    attack,
  }
}
