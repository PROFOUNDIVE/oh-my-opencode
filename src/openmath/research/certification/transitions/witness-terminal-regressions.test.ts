import { describe, expect, test } from "bun:test"

import { ResearchCertificationStateV1Schema } from "../state/schema"
import { evaluateCertificationEligibility, reduceCertificationTransition } from "./index"
import { completeTransitionState, TRANSITION_PROFILE } from "./transition-test-fixture"

describe("confirmed witness terminal regressions", () => {
  test("keeps a confirmed witness visible and approval ineligible after an amendment", () => {
    // given
    const ready = readyConfirmedState()

    // when
    const amended = reduceCertificationTransition(ready, {
      type: "ADD_AMENDMENT",
      kind: "required_check",
      scope: "witness:attack-0001",
      content: "Inspect the confirmed witness again.",
    }, ready.certification_revision)

    // then
    expect(amended).toMatchObject({
      ok: true,
      state: { witness_verifications: [{ outcome: "CONFIRMED" }], amendments: [{ event_type: "ADDED", lifecycle: "ACTIVE" }] },
    })
    if (!amended.ok) throw new TypeError(amended.message)
    expect(evaluateCertificationEligibility({ state: amended.state, profile: TRANSITION_PROFILE }).approval_eligible).toBe(false)
  })

  test("rejects attempts to suppress a confirmed witness with a later negative attack", () => {
    // given
    const ready = readyConfirmedState()
    const confirmedAttack = ready.attack_attempts[0]
    if (confirmedAttack?.outcome !== "COUNTEREXAMPLE_FOUND") throw new TypeError("Missing confirmed attack")
    const suppressed = {
      ...ready,
      attack_attempts: ready.attack_attempts.map((attack) => attack.attack_attempt_id === confirmedAttack.attack_attempt_id
        ? { ...attack, outcome: "NO_COUNTEREXAMPLE_FOUND", witness: null, witness_sha256: null }
        : attack),
    }

    // when
    const reparsed = ResearchCertificationStateV1Schema.safeParse(suppressed)
    const recommit = reduceCertificationTransition(ready, {
      type: "COMMIT_ATTACKS",
      completed_jobs: [],
      attack_attempts: [],
      evidence_receipts: [],
      profile: TRANSITION_PROFILE,
    }, ready.certification_revision)

    // then
    expect(reparsed.success).toBe(false)
    expect(recommit).toMatchObject({ ok: false, error_code: "ILLEGAL_TRANSITION", state: ready })
  })

  test("rejects a witness receipt that reuses the attacker child session", () => {
    // given
    const complete = completeTransitionState("CONFIRMED")
    const attackJob = complete.job_attempts.find((job) => job.job_kind === "ATTACK" && job.phase === "COMMITTED")
    if (attackJob?.phase !== "COMMITTED") throw new TypeError("Missing committed attack")
    const sharedSession = attackJob.child_session_id
    const reused = {
      ...complete,
      job_attempts: complete.job_attempts.map((job) => job.job_kind === "WITNESS" ? { ...job, child_session_id: sharedSession } : job),
      evidence_receipts: complete.evidence_receipts.map((receipt) => receipt.job_kind === "WITNESS"
        ? { ...receipt, child_session_id: sharedSession }
        : receipt),
    }

    // when
    const parsed = ResearchCertificationStateV1Schema.safeParse(reused)

    // then
    expect(parsed.success).toBe(false)
  })
})

function readyConfirmedState() {
  const complete = completeTransitionState("CONFIRMED")
  return ResearchCertificationStateV1Schema.parse({
    ...complete,
    certification_revision: complete.certification_revision - 1,
    phase: "WITNESS_VERIFICATION",
    status: "READY",
    summary: null,
    finalization: null,
  })
}
