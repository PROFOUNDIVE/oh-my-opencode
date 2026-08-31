import { expect, test } from "bun:test"

import { CertificationJobAttemptSchema } from "../state/jobs"
import { ResearchCertificationStateV1Schema } from "../state/schema"
import { completeTransitionState } from "../transitions/transition-test-fixture"
import { prepareCertificationJobAttempt } from "./prepare-certification-job-attempt"

test("prepares extraction, coverage, attack, and witness jobs with separate exact targets", () => {
  // given
  const state = ResearchCertificationStateV1Schema.parse(completeTransitionState("REJECTED"))
  const sources = ["EXTRACTION", "COVERAGE", "ATTACK", "WITNESS"].map((kind) => {
    const source = state.job_attempts.find((job) => job.job_kind === kind)
    if (source === undefined) throw new TypeError(`Missing ${kind} fixture job`)
    return source
  })

  // when
  const prepared = sources.map((source, index) => prepareCertificationJobAttempt({
    state,
    job_id: `cert-job-retry-${String(index + 1).padStart(4, "0")}`,
    target: source.target,
    role: source.role,
    resolved_model: source.resolved_model,
    prompt_sha256: source.prompt_sha256,
    input_sha256: source.input_sha256,
  }))

  // then
  expect(prepared.map((job) => job.job_kind)).toEqual(["EXTRACTION", "COVERAGE", "ATTACK", "WITNESS"])
  expect(prepared.map((job) => job.target)).toEqual(sources.map((job) => job.target))
  expect(new Set(prepared.map((job) => job.idempotency_key)).size).toBe(4)
  expect(prepared.every((job) => (
    job.certification_id === state.certification_id
    && job.generation_id === state.generation_id
    && job.certification_profile_sha256 === state.certification_profile_sha256
    && job.reference_sha256 === state.reference_sha256
  ))).toBe(true)
})

test("rejects completed receipts that do not bind the exact job target", () => {
  // given
  const state = ResearchCertificationStateV1Schema.parse(completeTransitionState("REJECTED"))
  const mismatches = state.job_attempts.map((job): unknown => {
    switch (job.job_kind) {
      case "EXTRACTION": return { ...job, receipt: { kind: "COVERAGE", coverage_review_id: "coverage-9999" } }
      case "COVERAGE": return { ...job, receipt: { kind: "COVERAGE", coverage_review_id: "coverage-9999" } }
      case "ATTACK": return { ...job, receipt: { kind: "ATTACK", attack_attempt_id: "attack-9999" } }
      case "WITNESS": return { ...job, receipt: { kind: "WITNESS", witness_verification_id: "witness-9999" } }
      default: return assertNever(job.job_kind)
    }
  })

  // when
  const results = mismatches.map((job) => CertificationJobAttemptSchema.safeParse(job))

  // then
  expect(results.every((result) => !result.success)).toBe(true)
})

function assertNever(value: never): never {
  throw new TypeError(`Unexpected certification job kind: ${String(value)}`)
}
