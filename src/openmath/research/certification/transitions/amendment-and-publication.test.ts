import { describe, expect, test } from "bun:test"

import { hashResearchCertificationState, ResearchCertificationStateV1Schema } from "../state/schema"
import { readyCertificationState } from "../state/certification-test-fixture"
import {
  activeCertificationAmendments,
  admitCertificationPublication,
  reduceCertificationTransition,
} from "./index"
import { completeTransitionState, TRANSITION_PROFILE } from "./transition-test-fixture"

describe("certification amendment lifecycle", () => {
  test("adds, retracts, and consumes amendments with one revision each", () => {
    // given
    const state = ResearchCertificationStateV1Schema.parse(readyCertificationState())

    // when
    const added = reduceCertificationTransition(state, {
      type: "ADD_AMENDMENT",
      kind: "required_check",
      scope: "graph",
      content: "Review this graph.",
    }, 0)
    if (!added.ok) throw new TypeError("Expected amendment addition")
    const retracted = reduceCertificationTransition(added.state, {
      type: "RETRACT_AMENDMENT",
      amendment_id: "cert-amendment-1",
    }, 1)
    const second = reduceCertificationTransition(added.state, {
      type: "CONSUME_AMENDMENTS",
      amendment_ids: ["cert-amendment-1"],
    }, 1)

    // then
    expect(added.state.certification_revision).toBe(1)
    expect(retracted).toMatchObject({ ok: true, state: { certification_revision: 2 } })
    expect(second).toMatchObject({ ok: true, state: { certification_revision: 2 } })
    if (!retracted.ok || !second.ok) throw new TypeError("Expected terminal amendment events")
    expect(activeCertificationAmendments(retracted.state)).toEqual([])
    expect(activeCertificationAmendments(second.state)).toEqual([])
  })

  test("rejects stale, unknown, consumed, and terminal amendment mutation", () => {
    // given
    const state = ResearchCertificationStateV1Schema.parse(readyCertificationState())
    const aborted = reduceCertificationTransition(state, { type: "ABORT", reason: null }, 0)
    if (!aborted.ok) throw new TypeError("Expected abort")

    // when
    const unknown = reduceCertificationTransition(state, { type: "RETRACT_AMENDMENT", amendment_id: "cert-amendment-1" }, 0)
    const terminal = reduceCertificationTransition(aborted.state, {
      type: "ADD_AMENDMENT",
      kind: "question",
      scope: "coverage",
      content: "Review coverage.",
    }, 1)

    // then
    expect(unknown).toMatchObject({ ok: false, error_code: "VALIDATION_ERROR", state })
    expect(terminal).toMatchObject({ ok: false, error_code: "ILLEGAL_TRANSITION", state: aborted.state })
  })
})

describe("final publication admission", () => {
  test("admits only exact campaign, artifact, profile, revision, attachment, and dossier hashes", () => {
    // given
    const state = completeTransitionState("REJECTED")
    const sidecarSha256 = hashResearchCertificationState(state)
    const dossierSha256 = "d".repeat(64)
    const input = {
      campaign_phase: "PROMOTION" as const,
      campaign_status: "READY" as const,
      current_state_revision: 12,
      expected_state_revision: 12,
      state,
      expected_certification_revision: state.certification_revision,
      observed_selected_artifact: state.selected_artifact,
      expected_certification_profile_sha256: state.certification_profile_sha256,
      computed_sidecar_sha256: sidecarSha256,
      attachment_content_sha256: sidecarSha256,
      persisted_dossier_sha256: dossierSha256,
      computed_dossier_sha256: dossierSha256,
      dossier_attachment_sha256: sidecarSha256,
      profile: TRANSITION_PROFILE,
    }

    // when
    const admitted = admitCertificationPublication(input)
    const staleDossier = admitCertificationPublication({ ...input, computed_dossier_sha256: "e".repeat(64) })
    const aborted = admitCertificationPublication({ ...input, campaign_status: "ABORTED" })

    // then
    expect(admitted).toEqual({ ok: true })
    expect(staleDossier).toMatchObject({ ok: false, error_code: "DOSSIER_HASH_MISMATCH" })
    expect(aborted).toMatchObject({ ok: false, error_code: "CAMPAIGN_ABORTED" })
  })

  test("rejects confirmed or inconclusive witnesses even when dossier hashes match", () => {
    // given
    const states = [completeTransitionState("INCONCLUSIVE"), completeTransitionState("CONFIRMED")]

    // when
    const results = states.map((state) => {
      const stateHash = hashResearchCertificationState(state)
      return admitCertificationPublication({
        campaign_phase: "PROMOTION",
        campaign_status: "READY",
        current_state_revision: 12,
        expected_state_revision: 12,
        state,
        expected_certification_revision: state.certification_revision,
        observed_selected_artifact: state.selected_artifact,
        expected_certification_profile_sha256: state.certification_profile_sha256,
        computed_sidecar_sha256: stateHash,
        attachment_content_sha256: stateHash,
        persisted_dossier_sha256: "d".repeat(64),
        computed_dossier_sha256: "d".repeat(64),
        dossier_attachment_sha256: stateHash,
        profile: TRANSITION_PROFILE,
      })
    })

    // then
    expect(results.every((result) => !result.ok && result.error_code === "APPROVAL_INELIGIBLE")).toBe(true)
  })
})
