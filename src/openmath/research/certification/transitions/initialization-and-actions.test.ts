import { describe, expect, test } from "bun:test"

import { ResearchCertificationStateV1Schema } from "../state/schema"
import {
  HASH_A,
  HASH_B,
  HASH_C,
  HASH_D,
  HASH_E,
  readyCertificationState,
  selectedArtifact,
} from "../state/certification-test-fixture"
import { CertificationSelectedArtifactSchema } from "../state/identity"
import {
  getCertificationNextActions,
  initializeCertification,
  reduceCertificationTransition,
  shouldContinueCertificationStep,
} from "./index"

describe("certification initialization and revision admission", () => {
  test("initializes the exact empty revision-zero state", () => {
    // given
    const artifact = CertificationSelectedArtifactSchema.parse(selectedArtifact())

    // when
    const result = initializeCertification({
      campaign_id: "campaign-a",
      selected_artifact: artifact,
      observed_selected_artifact: artifact,
      objective_sha256: HASH_C,
      profile_sha256: HASH_D,
      reference_sha256: HASH_E,
      certification_profile_sha256: HASH_B,
    })

    // then
    expect(result.ok).toBe(true)
    if (!result.ok) throw new TypeError("Expected initialized certification")
    expect(result.state).toMatchObject({
      certification_revision: 0,
      phase: "EXTRACTION",
      status: "READY",
      graphs: [],
      job_attempts: [],
    })
    expect(ResearchCertificationStateV1Schema.safeParse(result.state).success).toBe(true)
  })

  test("rejects an observed artifact mismatch as STALE_ARTIFACT", () => {
    // given
    const selected = CertificationSelectedArtifactSchema.parse(selectedArtifact())
    const observed = { ...selected, artifact_sha256: HASH_E }

    // when
    const result = initializeCertification({
      campaign_id: "campaign-a",
      selected_artifact: selected,
      observed_selected_artifact: observed,
      objective_sha256: HASH_C,
      profile_sha256: HASH_D,
      reference_sha256: HASH_E,
      certification_profile_sha256: HASH_B,
    })

    // then
    expect(result).toEqual({ ok: false, error_code: "STALE_ARTIFACT", message: "Selected artifact identity is stale" })
  })

  test("rejects stale certification revisions without mutation", () => {
    // given
    const state = ResearchCertificationStateV1Schema.parse(readyCertificationState())

    // when
    const result = reduceCertificationTransition(state, { type: "ABORT", reason: "stop" }, 1)

    // then
    expect(result).toMatchObject({ ok: false, error_code: "STALE_CERTIFICATION_REVISION", state })
    expect(result.state).toBe(state)
  })
})

describe("certification action and continuation matrix", () => {
  test("renders exact dual-revision actions for every effective status", () => {
    // given
    const rows = [
      ["NOT_STARTED", false, ["step_one_stage", "step_to_checkpoint", "abort"]],
      ["READY", false, ["step_one_stage", "step_to_checkpoint", "amend", "abort"]],
      ["RUNNING", false, ["step_one_stage", "abort"]],
      ["AWAITING_HUMAN", false, ["amend", "abort"]],
      ["AWAITING_HUMAN", true, ["step_one_stage", "step_to_checkpoint", "amend", "abort"]],
      ["BLOCKED", false, ["step_one_stage", "abort"]],
      ["BLOCKED", true, ["step_one_stage", "amend", "abort"]],
      ["COMPLETE", false, ["step_one_stage", "abort"]],
      ["BEFORE_PROMOTION", false, ["promote", "abort"]],
      ["ABORTED", false, []],
    ] as const

    // when
    const actions = rows.map(([effectiveStatus, hasApplicableAmendment]) => getCertificationNextActions({
      effective_status: effectiveStatus,
      required_state_revision: 9,
      required_certification_revision: effectiveStatus === "NOT_STARTED" ? null : 4,
      has_applicable_amendment: hasApplicableAmendment,
    }))

    // then
    expect(actions.map((items) => items.map((item) => item.action))).toEqual(rows.map((row) => [...row[2]]))
    expect(actions[0]?.every((item) => !("required_certification_revision" in item))).toBe(true)
    expect(actions.slice(1).flat().every((item) => item.required_certification_revision === 4)).toBe(true)
  })

  test("continues to_checkpoint only from READY and never continues one_stage", () => {
    // given
    const ready = ResearchCertificationStateV1Schema.parse(readyCertificationState())
    const paused = ResearchCertificationStateV1Schema.parse({
      ...readyCertificationState(),
      certification_revision: 1,
      phase: "COVERAGE_REVIEW",
      status: "AWAITING_HUMAN",
      awaiting_reason: "COVERAGE_REVIEW_REQUIRED",
    })

    // when
    const decisions = [
      shouldContinueCertificationStep("one_stage", ready),
      shouldContinueCertificationStep("to_checkpoint", ready),
      shouldContinueCertificationStep("to_checkpoint", paused),
    ]

    // then
    expect(decisions).toEqual([false, true, false])
  })

  test("campaign abort makes later receipts and terminal mutations inadmissible", () => {
    // given
    const state = ResearchCertificationStateV1Schema.parse(readyCertificationState())
    const aborted = reduceCertificationTransition(state, { type: "ABORT", reason: null }, 0)
    if (!aborted.ok) throw new TypeError("Expected abort transition")

    // when
    const later = reduceCertificationTransition(aborted.state, {
      type: "BLOCK",
      reason: "DISPATCH_FAILED",
    }, 1)

    // then
    expect(aborted.state).toMatchObject({ status: "ABORTED", abort_requested: true })
    expect(later).toMatchObject({ ok: false, error_code: "ILLEGAL_TRANSITION", state: aborted.state })
    expect(later.state).toBe(aborted.state)
  })
})

test("artifact mismatch does not create a replacement generation", () => {
  // given
  const state = ResearchCertificationStateV1Schema.parse(readyCertificationState())
  const observed = { ...state.selected_artifact, artifact_sha256: HASH_A === HASH_E ? HASH_D : HASH_E }

  // when
  const result = reduceCertificationTransition(state, {
    type: "CHECK_ARTIFACT",
    observed_selected_artifact: observed,
  }, 0)

  // then
  expect(result).toMatchObject({ ok: false, error_code: "STALE_ARTIFACT", state })
  expect(result.state).toBe(state)
})
