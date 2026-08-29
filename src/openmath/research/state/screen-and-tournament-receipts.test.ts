import { describe, expect, test } from "bun:test"

import { sha256 } from "../../workflow/stage-runner/sha256"
import { ScreenReceiptSchema, TournamentReceiptSchema } from "./index"

const HASH = "a".repeat(64)

describe("screen receipts", () => {
  test("records categorical normalized output and immutable screen provenance", () => {
    // given
    const input = screenReceipt()

    // when
    const parsed = ScreenReceiptSchema.parse(input)

    // then
    expect(parsed.verdict).toBe("REPAIRABLE")
    expect(parsed.unresolved_obligations).toEqual(["Boundary lemma remains unresolved."])
    expect(parsed.attachments).toEqual([])
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed.blocking_issues)).toBe(true)
  })

  test("rejects numeric and unknown screen-result fields", () => {
    // given
    const invalid = [
      { ...screenReceipt(), score: 0.9 },
      { ...screenReceipt(), probability: 1 },
      { ...screenReceipt(), verification: { status: "PASS" } },
    ]

    // when
    const results = invalid.map((receipt) => ScreenReceiptSchema.safeParse(receipt))

    // then
    expect(results.every((result) => !result.success)).toBe(true)
  })
})

describe("tournament receipts", () => {
  test("accepts exactly one categorical KEEP with all other actions DROP", () => {
    // given
    const input = tournamentReceipt({
      kind: "DECIDED",
      actions: [
        { candidate_id: "direct-01", action: "KEEP" },
        { candidate_id: "construction-01", action: "DROP" },
      ],
      synthesis_brief: null,
      synthesis_brief_sha256: null,
    })

    // when
    const parsed = TournamentReceiptSchema.safeParse(input)

    // then
    expect(parsed.success).toBe(true)
  })

  test("accepts one merge directive represented by two or more categorical parent actions", () => {
    // given
    const synthesisBrief = "Preserve the reduction and use the construction."
    const input = tournamentReceipt({
      kind: "DECIDED",
      actions: [
        { candidate_id: "direct-01", action: "MERGE_IDEA" },
        { candidate_id: "construction-01", action: "MERGE_IDEA" },
      ],
      synthesis_brief: synthesisBrief,
      synthesis_brief_sha256: sha256(synthesisBrief),
    })

    // when
    const parsed = TournamentReceiptSchema.safeParse(input)

    // then
    expect(parsed.success).toBe(true)
  })

  test("rejects a merge synthesis hash that does not bind the exact brief", () => {
    // given
    const input = tournamentReceipt({
      kind: "DECIDED",
      actions: [
        { candidate_id: "direct-01", action: "MERGE_IDEA" },
        { candidate_id: "construction-01", action: "MERGE_IDEA" },
      ],
      synthesis_brief: "Preserve the reduction and use the construction.",
      synthesis_brief_sha256: HASH,
    })

    // when
    const parsed = TournamentReceiptSchema.safeParse(input)

    // then
    expect(parsed.success).toBe(false)
  })

  test("accepts an overall needs-human result without candidate actions", () => {
    // given
    const input = tournamentReceipt({ kind: "NEEDS_HUMAN" })

    // when
    const parsed = TournamentReceiptSchema.safeParse(input)

    // then
    expect(parsed.success).toBe(true)
  })

  test("rejects mixed winners, duplicate candidates, one-parent merges, and numeric ranking fields", () => {
    // given
    const invalidResults = [
      decided([action("direct-01", "KEEP"), action("construction-01", "KEEP")]),
      decided([action("direct-01", "KEEP"), action("construction-01", "MERGE_IDEA")]),
      merge([action("direct-01", "MERGE_IDEA")]),
      decided([action("direct-01", "KEEP"), action("direct-01", "DROP")]),
      decided([{ ...action("direct-01", "KEEP"), rank: 1 }]),
      { ...decided([action("direct-01", "KEEP")]), synthesis_brief_sha256: HASH },
      { ...decided([action("direct-01", "KEEP")]), synthesis_brief: "Unexpected brief." },
    ]

    // when
    const results = invalidResults.map((result) => TournamentReceiptSchema.safeParse(tournamentReceipt(result)))

    // then
    expect(results.every((result) => !result.success)).toBe(true)
  })
})

function screenReceipt() {
  return {
    screen_id: "screen-direct-01",
    job_id: "job-screen-direct-01",
    campaign_revision: 4,
    candidate_id: "direct-01",
    artifact: artifact("campaign-1::direct-01"),
    screen_role: "logical-soundness",
    verdict: "REPAIRABLE",
    blocking_issues: ["Repair the boundary step."],
    unresolved_obligations: ["Boundary lemma remains unresolved."],
    assumptions: ["Finite-dimensional setting."],
    novel_elements: ["Reduction to the boundary lemma."],
    reviewer_session_id: "ses_screenChild1",
    resolved_model: { providerID: "anthropic", modelID: "claude-opus" },
    profile_sha256: HASH,
    prompt_sha256: HASH,
    reference_sha256: HASH,
    raw_output_sha256: HASH,
  }
}

function tournamentReceipt(result: object) {
  return {
    tournament_id: "tournament-initial",
    job_id: "job-tournament-initial",
    campaign_revision: 6,
    screen_ids: ["screen-direct-01", "screen-construction-01"],
    result,
    reviewer_session_id: "ses_tournamentChild1",
    resolved_model: { providerID: "openai", modelID: "gpt-5" },
    profile_sha256: HASH,
    prompt_sha256: HASH,
    reference_sha256: HASH,
    raw_output_sha256: HASH,
  }
}

function artifact(childRunId: string) {
  return {
    child_run_id: childRunId,
    child_state_revision: 2,
    artifact_version: 1,
    media_type: "text/markdown",
    sha256: HASH,
  }
}

function action(candidateId: string, tournamentAction: string) {
  return { candidate_id: candidateId, action: tournamentAction }
}

function decided(actions: readonly object[]) {
  return { kind: "DECIDED", actions, synthesis_brief: null, synthesis_brief_sha256: null }
}

function merge(actions: readonly object[]) {
  return { kind: "DECIDED", actions, synthesis_brief: "Merge both ideas.", synthesis_brief_sha256: HASH }
}
