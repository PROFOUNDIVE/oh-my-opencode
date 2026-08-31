import { describe, expect, test } from "bun:test"

import { ResearchCertificationStateV1Schema, hashResearchCertificationState } from "./schema"
import { hashCertificationSummary } from "./summary"
import { completeCertificationState } from "./complete-state-test-fixture"
import { completeCertificationStateWithWitness } from "./witness-state-test-fixture"

describe("certification summary and finalization", () => {
  test("accepts a complete state with exact derived summary and finalization hashes", () => {
    // given
    const input = completeCertificationState()

    // when
    const parsed = ResearchCertificationStateV1Schema.safeParse(input)

    // then
    expect(parsed.success).toBe(true)
    if (!parsed.success || parsed.data.status !== "COMPLETE") throw new TypeError("Expected complete certification fixture")
    expect(hashCertificationSummary(parsed.data.summary)).toBe(input.finalization.summary_sha256)
    expect(hashResearchCertificationState(parsed.data)).toBe(hashResearchCertificationState(parsed.data))
  })

  test("rejects count-based, stale-graph, revision, and summary-hash finalization claims", () => {
    // given
    const base = completeCertificationState()
    const invalid = [
      { ...base, summary: { ...base.summary, total_obligation_count: 99 } },
      { ...base, summary: { ...base.summary, approval_eligible: false } },
      { ...base, finalization: { ...base.finalization, completed_at_revision: 2 } },
      { ...base, finalization: { ...base.finalization, graph_sha256: "f".repeat(64) } },
      { ...base, finalization: { ...base.finalization, summary_sha256: "f".repeat(64) } },
    ]

    // when
    const results = invalid.map((state) => ResearchCertificationStateV1Schema.safeParse(state))

    // then
    expect(results.every((result) => !result.success)).toBe(true)
  })

  test("rejects missing committed evidence and cross-generation records", () => {
    // given
    const base = completeCertificationState()
    const invalid = [
      { ...base, evidence_receipts: base.evidence_receipts.slice(1) },
      {
        ...base,
        evidence_receipts: [{ ...base.evidence_receipts[0], graph_sha256: "f".repeat(64) }, ...base.evidence_receipts.slice(1)],
      },
      {
        ...base,
        job_attempts: base.job_attempts.map((job) => ({ ...job, generation_id: "f".repeat(64) })),
      },
      {
        ...base,
        coverage_reviews: [{ ...base.coverage_reviews[0], artifact_sha256: "f".repeat(64) }],
      },
    ]

    // when
    const results = invalid.map((state) => ResearchCertificationStateV1Schema.safeParse(state))

    // then
    expect(results.every((result) => !result.success)).toBe(true)
  })

  test("keeps all witness outcomes visible while only REJECTED remains approval eligible", () => {
    // given
    const outcomes = ["REJECTED", "INCONCLUSIVE", "CONFIRMED"] as const
    const states = outcomes.map(completeCertificationStateWithWitness)

    // when
    const results = states.map((state) => ResearchCertificationStateV1Schema.safeParse(state))
    const forcedApproval = ResearchCertificationStateV1Schema.safeParse({
      ...states[1],
      summary: { ...states[1]?.summary, approval_eligible: true },
    })

    // then
    expect(results.every((result) => result.success)).toBe(true)
    expect(results.map((result) => result.success && result.data.status === "COMPLETE" ? result.data.summary.approval_eligible : null)).toEqual([true, false, false])
    expect(forcedApproval.success).toBe(false)
  })

  test("rejects committed result records that disagree with exact job targets", () => {
    // given
    const coverageBase = completeCertificationState()
    const coverageMismatch = {
      ...coverageBase,
      job_attempts: coverageBase.job_attempts.map((job) => job.job_kind === "COVERAGE"
        ? { ...job, target: { ...job.target, coverage_round: 2 } }
        : job),
    }
    const witnessBase = completeCertificationStateWithWitness("REJECTED")
    const graph = witnessBase.graphs[0]
    const otherNode = graph?.nodes[1]
    if (otherNode === undefined) throw new TypeError("Missing alternate target node")
    const witnessMismatch = {
      ...witnessBase,
      job_attempts: witnessBase.job_attempts.map((job) => job.job_kind === "WITNESS"
        ? { ...job, target: { ...job.target, obligation_id: otherNode.obligation_id, node_sha256: otherNode.node_sha256 } }
        : job),
    }
    const attackMismatch = {
      ...witnessBase,
      job_attempts: witnessBase.job_attempts.map((job) => job.job_kind === "ATTACK"
        ? { ...job, target: { ...job.target, mode: "FINITE_SEARCH" } }
        : job),
    }
    const pendingWitnessMismatch = {
      ...witnessBase,
      certification_revision: 4,
      phase: "WITNESS_VERIFICATION",
      status: "RUNNING",
      active_job_ids: ["cert-job-witness-0001"],
      witness_verifications: [],
      evidence_receipts: witnessBase.evidence_receipts.slice(0, 3),
      summary: null,
      finalization: null,
      job_attempts: witnessBase.job_attempts.map((job) => {
        if (job.job_kind !== "WITNESS") return job
        const { child_session_id: _session, raw_output_sha256: _output, receipt: _receipt, ...prepared } = job
        return {
          ...prepared,
          phase: "PREPARED",
          target: { ...job.target, obligation_id: otherNode.obligation_id, node_sha256: otherNode.node_sha256 },
        }
      }),
    }

    // when
    const results = [coverageMismatch, witnessMismatch, attackMismatch, pendingWitnessMismatch]
      .map((state) => ResearchCertificationStateV1Schema.safeParse(state))

    // then
    expect(results.every((result) => !result.success)).toBe(true)
  })
})
