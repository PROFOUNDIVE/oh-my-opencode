import { describe, expect, test } from "bun:test"

import { ResearchCertificationStateV1Schema } from "../state/schema"
import { reduceCertificationTransition } from "./index"
import { certificationOperationFixture, commitFixtureExtraction } from "./operation-test-fixture"
import { certificationResultOperationFixture } from "./result-operation-test-fixture"
import { completeTransitionState, TRANSITION_PROFILE } from "./transition-test-fixture"

describe("certification operation prepare and commit", () => {
  test("persists extraction prepare and commit as separate exact revisions", () => {
    // given
    const fixture = certificationOperationFixture()

    // when
    const prepared = reduceCertificationTransition(fixture.initial, {
      type: "PREPARE_OPERATION",
      job_attempts: [fixture.extraction.prepared],
      consume_amendment_ids: [],
    }, 0)
    if (!prepared.ok) throw new TypeError("Expected extraction prepare")
    const committed = reduceCertificationTransition(prepared.state, {
      type: "COMMIT_EXTRACTION",
      completed_jobs: [fixture.extraction.completed],
      graph: fixture.graph,
      evidence_receipts: [fixture.extraction.evidence],
    }, 1)

    // then
    expect(prepared.state).toMatchObject({ certification_revision: 1, status: "RUNNING" })
    expect(committed).toMatchObject({
      ok: true,
      state: { certification_revision: 2, phase: "COVERAGE_REVIEW", status: "READY" },
    })
  })

  test("commits coverage PASS or REVISE without continuing past its persisted operation", () => {
    // given
    const fixture = certificationOperationFixture()
    const extracted = commitFixtureExtraction(fixture)
    const coveragePrepared = reduceCertificationTransition(extracted, {
      type: "PREPARE_OPERATION",
      job_attempts: [fixture.coverage.prepared],
      consume_amendment_ids: [],
    }, 2)
    if (!coveragePrepared.ok) throw new TypeError("Expected coverage prepare")

    // when
    const passed = reduceCertificationTransition(coveragePrepared.state, {
      type: "COMMIT_COVERAGE",
      completed_jobs: [fixture.coverage.completed],
      coverage: fixture.coverage.review,
      evidence_receipts: [fixture.coverage.evidence],
      profile: TRANSITION_PROFILE,
    }, 3)
    const revised = reduceCertificationTransition(coveragePrepared.state, {
      type: "COMMIT_COVERAGE",
      completed_jobs: [fixture.coverage.completed],
      coverage: { ...fixture.coverage.review, verdict: "REVISE" },
      evidence_receipts: [fixture.coverage.evidence],
      profile: TRANSITION_PROFILE,
    }, 3)

    // then
    expect(passed).toMatchObject({ ok: true, state: { certification_revision: 4, phase: "COUNTEREXAMPLE_ATTACK", status: "READY" } })
    expect(revised).toMatchObject({ ok: true, state: { certification_revision: 4, phase: "EXTRACTION", status: "READY" } })
  })

  test("rejects a completion that does not exactly match active prepared jobs", () => {
    // given
    const fixture = certificationOperationFixture()
    const prepared = reduceCertificationTransition(fixture.initial, {
      type: "PREPARE_OPERATION",
      job_attempts: [fixture.extraction.prepared],
      consume_amendment_ids: [],
    }, 0)
    if (!prepared.ok) throw new TypeError("Expected extraction prepare")

    // when
    const result = reduceCertificationTransition(prepared.state, {
      type: "COMMIT_EXTRACTION",
      completed_jobs: [],
      graph: fixture.graph,
      evidence_receipts: [fixture.extraction.evidence],
    }, 1)

    // then
    expect(result).toMatchObject({ ok: false, error_code: "VALIDATION_ERROR", state: prepared.state })
  })
})

describe("certification completion", () => {
  test("commits ordered attacks, a rejected witness, and completion through persisted operations", () => {
    // given
    const fixture = certificationResultOperationFixture()
    const attackPrepared = reduceCertificationTransition(fixture.ready_attack, {
      type: "PREPARE_OPERATION",
      job_attempts: fixture.attacks.prepared,
      consume_amendment_ids: [],
    }, 2)
    if (!attackPrepared.ok) throw new TypeError("Expected attack prepare")
    const attacks = reduceCertificationTransition(attackPrepared.state, {
      type: "COMMIT_ATTACKS",
      completed_jobs: fixture.attacks.completed,
      attack_attempts: fixture.attacks.records,
      evidence_receipts: fixture.attacks.evidence,
      profile: TRANSITION_PROFILE,
    }, 3)
    if (!attacks.ok) throw new TypeError("Expected attack commit")
    const witnessPrepared = reduceCertificationTransition(attacks.state, {
      type: "PREPARE_OPERATION",
      job_attempts: [fixture.witness.prepared],
      consume_amendment_ids: [],
    }, 4)
    if (!witnessPrepared.ok) throw new TypeError("Expected witness prepare")

    // when
    const witness = reduceCertificationTransition(witnessPrepared.state, {
      type: "COMMIT_WITNESSES",
      completed_jobs: [fixture.witness.completed],
      witness_verifications: [fixture.witness.record],
      evidence_receipts: [fixture.witness.evidence],
    }, 5)
    if (!witness.ok) throw new TypeError("Expected witness commit")
    const completed = reduceCertificationTransition(witness.state, { type: "COMPLETE", profile: TRANSITION_PROFILE }, 6)

    // then
    expect(attacks.state).toMatchObject({ certification_revision: 4, phase: "WITNESS_VERIFICATION", status: "READY" })
    expect(witness.state).toMatchObject({ certification_revision: 6, phase: "WITNESS_VERIFICATION", status: "READY" })
    expect(completed).toMatchObject({ ok: true, state: { certification_revision: 7, status: "COMPLETE" } })
  })

  test("completes the exact attack and rejected-witness happy path", () => {
    // given
    const complete = completeTransitionState("REJECTED")
    const ready = ResearchCertificationStateV1Schema.parse({
      ...complete,
      certification_revision: complete.certification_revision - 1,
      phase: "WITNESS_VERIFICATION",
      status: "READY",
      summary: null,
      finalization: null,
    })

    // when
    const result = reduceCertificationTransition(ready, { type: "COMPLETE", profile: TRANSITION_PROFILE }, ready.certification_revision)

    // then
    expect(result).toMatchObject({ ok: true, state: { phase: "COMPLETE", status: "COMPLETE" } })
    if (!result.ok || result.state.status !== "COMPLETE") throw new TypeError("Expected complete certification")
    expect(result.state.summary.approval_eligible).toBe(true)
  })

  test("completes visible adverse witnesses but keeps approval ineligible", () => {
    // given
    const complete = completeTransitionState("CONFIRMED")
    const ready = ResearchCertificationStateV1Schema.parse({
      ...complete,
      certification_revision: complete.certification_revision - 1,
      phase: "WITNESS_VERIFICATION",
      status: "READY",
      summary: null,
      finalization: null,
    })

    // when
    const result = reduceCertificationTransition(ready, { type: "COMPLETE", profile: TRANSITION_PROFILE }, ready.certification_revision)

    // then
    expect(result).toMatchObject({ ok: true, state: { summary: { approval_eligible: false } } })
  })
})
