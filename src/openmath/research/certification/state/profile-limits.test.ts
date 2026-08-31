import { describe, expect, test } from "bun:test"

import { CertificationProfileBoundStateSchema } from "./profile-bound-state"
import { completeCertificationState } from "./complete-state-test-fixture"

describe("certification profile-bound state", () => {
  test("accepts an in-progress state within exact graph, coverage, attack, and concurrency limits", () => {
    // given
    const complete = completeCertificationState()
    const state = { ...complete, phase: "COUNTEREXAMPLE_ATTACK", status: "READY", summary: null, finalization: null }
    const input = { state, profile: profileLimits(complete.certification_profile_sha256) }

    // when
    const parsed = CertificationProfileBoundStateSchema.safeParse(input)

    // then
    expect(parsed.success).toBe(true)
  })

  test("rejects profile mismatch, graph overflow, and completion before the full bounded attack plan", () => {
    // given
    const state = completeCertificationState()
    const profile = profileLimits(state.certification_profile_sha256)
    const invalid = [
      { state, profile: { ...profile, certification_profile_sha256: "f".repeat(64) } },
      { state: { ...state, phase: "COUNTEREXAMPLE_ATTACK", status: "READY", summary: null, finalization: null }, profile: { ...profile, max_obligations: 5 } },
      { state, profile },
    ]

    // when
    const results = invalid.map((input) => CertificationProfileBoundStateSchema.safeParse(input))

    // then
    expect(results.every((result) => !result.success)).toBe(true)
  })
})

function profileLimits(certificationProfileSha256: string) {
  return {
    certification_profile_sha256: certificationProfileSha256,
    max_obligations: 6,
    max_coverage_rounds: 1,
    max_coverage_findings: 4,
    allowed_attack_modes: ["EDGE_CASE"],
    max_attacks_per_obligation: 1,
    max_active_certification_jobs: 4,
  }
}
