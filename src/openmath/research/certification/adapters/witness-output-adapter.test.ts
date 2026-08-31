import { describe, expect, test } from "bun:test"

import { completeTransitionState } from "../transitions/transition-test-fixture"
import { adaptCertificationWitnessOutput } from "./witness-output-adapter"

describe("certification witness output adapter", () => {
  test("preserves rejected and inconclusive witness outcomes visibly", () => {
    // given
    const context = witnessContext()

    // when
    const rejected = adaptCertificationWitnessOutput('{"outcome":"REJECTED"}', context)
    const inconclusive = adaptCertificationWitnessOutput('{"outcome":"INCONCLUSIVE"}', context)

    // then
    expect(rejected).toEqual({ ok: true, output: { outcome: "REJECTED" } })
    expect(inconclusive).toEqual({ ok: true, output: { outcome: "INCONCLUSIVE" } })
  })

  test("preserves a confirmed witness outcome", () => {
    // given
    const context = witnessContext()

    // when
    const result = adaptCertificationWitnessOutput('{"outcome":"CONFIRMED"}', context)

    // then
    expect(result).toEqual({ ok: true, output: { outcome: "CONFIRMED" } })
  })

  test("rejects malformed unknown numeric and duplicate verifier output", () => {
    // given
    const context = witnessContext()
    const outputs = [
      "not json",
      '{"outcome":"UNKNOWN"}',
      '{"outcome":1}',
      '{"outcome":"REJECTED","reason":"attacker said so"}',
      '{"outcome":"REJECTED","outcome":"CONFIRMED"}',
    ]

    // when
    const results = outputs.map((output) => adaptCertificationWitnessOutput(output, context))

    // then
    expect(results.map((result) => result.ok ? null : result.error.code)).toEqual([
      "INVALID_JSON",
      "INVALID_WITNESS_OUTPUT",
      "INVALID_WITNESS_OUTPUT",
      "INVALID_WITNESS_OUTPUT",
      "DUPLICATE_FIELD",
    ])
  })

  test("rejects stale target and witness hashes before parsing an outcome", () => {
    // given
    const context = witnessContext()

    // when
    const staleTarget = adaptCertificationWitnessOutput('{"outcome":"REJECTED"}', {
      ...context,
      target: { ...context.target, node_sha256: "f".repeat(64) },
    })
    const staleWitness = adaptCertificationWitnessOutput('{"outcome":"REJECTED"}', {
      ...context,
      target: { ...context.target, witness_sha256: "e".repeat(64) },
    })

    // then
    expect(staleTarget).toMatchObject({ ok: false, error: { code: "STALE_TARGET" } })
    expect(staleWitness).toMatchObject({ ok: false, error: { code: "STALE_TARGET" } })
  })
})

function witnessContext() {
  const state = completeTransitionState("REJECTED")
  const attack = state.attack_attempts[0]
  const job = state.job_attempts.find((candidate) => candidate.target.kind === "WITNESS")
  if (attack?.outcome !== "COUNTEREXAMPLE_FOUND" || job?.target.kind !== "WITNESS") {
    throw new TypeError("Missing witness adapter fixture")
  }
  return { attack, target: job.target }
}
