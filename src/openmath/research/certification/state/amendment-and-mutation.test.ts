import { describe, expect, test } from "bun:test"

import { CertificationAmendmentHistorySchema } from "./amendments"
import { completeCertificationState } from "./complete-state-test-fixture"
import { CertificationStateMutationSchema } from "./mutation"
import { readyCertificationState } from "./certification-test-fixture"

describe("certification amendments", () => {
  test("accepts append-only graph, coverage, counterexample, and attack-bound witness scopes", () => {
    // given
    const scopes = ["graph", "coverage", "counterexample:obligation-0001", "witness:attack-0001"]
    const histories = scopes.map((scope, index) => [{
      event_type: "ADDED",
      amendment_id: `cert-amendment-${index + 1}`,
      kind: "required_check",
      scope,
      content: "Review this exact concern.",
      lifecycle: "ACTIVE",
      certification_revision: index + 1,
    }])

    // when
    const results = histories.map((history) => CertificationAmendmentHistorySchema.safeParse(history))

    // then
    expect(results.every((result) => result.success)).toBe(true)
  })

  test("rejects witness-by-obligation scope and invalid consume/retract lifecycles", () => {
    // given
    const added = {
      event_type: "ADDED",
      amendment_id: "cert-amendment-1",
      kind: "question",
      scope: "witness:obligation-0001",
      content: "Check witness.",
      lifecycle: "ACTIVE",
      certification_revision: 1,
    }
    const consumed = {
      event_type: "CONSUMED",
      amendment_id: "cert-amendment-1",
      lifecycle: "ACTIVE",
      certification_revision: 2,
    }

    // when
    const badScope = CertificationAmendmentHistorySchema.safeParse([added])
    const missingAdd = CertificationAmendmentHistorySchema.safeParse([consumed])
    const doubleConsume = CertificationAmendmentHistorySchema.safeParse([{ ...added, scope: "graph" }, consumed, { ...consumed, certification_revision: 3 }])

    // then
    expect([badScope, missingAdd, doubleConsume].every((result) => !result.success)).toBe(true)
  })
})

describe("certification terminal mutation", () => {
  test("rejects every mutation after ABORTED or COMPLETE", () => {
    // given
    const aborted = {
      ...readyCertificationState(),
      certification_revision: 1,
      status: "ABORTED",
      abort_requested: true,
      abort_reason: "stopped",
    }
    const next = { ...aborted, certification_revision: 2 }
    const complete = completeCertificationState()

    // when
    const afterAbort = CertificationStateMutationSchema.safeParse({ previous: aborted, next })
    const afterComplete = CertificationStateMutationSchema.safeParse({ previous: complete, next: complete })

    // then
    expect(afterAbort.success).toBe(false)
    expect(afterComplete.success).toBe(false)
  })

  test("rejects generation, campaign, artifact, profile, or revision changes between nonterminal revisions", () => {
    // given
    const previous = readyCertificationState()
    const next = { ...previous, certification_revision: 1 }
    const invalid = [
      { ...next, campaign_id: "other-campaign" },
      { ...next, generation_id: "f".repeat(64) },
      { ...next, selected_artifact: { ...next.selected_artifact, artifact_sha256: "f".repeat(64) } },
      { ...next, certification_profile_sha256: "f".repeat(64) },
      { ...next, certification_revision: 2 },
    ]

    // when
    const valid = CertificationStateMutationSchema.safeParse({ previous, next })
    const invalidResults = invalid.map((candidate) => CertificationStateMutationSchema.safeParse({ previous, next: candidate }))

    // then
    expect(valid.success).toBe(true)
    expect(invalidResults.every((result) => !result.success)).toBe(true)
  })
})
