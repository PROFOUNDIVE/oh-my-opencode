import { describe, expect, test } from "bun:test"

import { sha256 } from "../../workflow/stage-runner/sha256"
import { CandidateIdSchema } from "../state"
import { adaptTournamentOutput, type TournamentLabelMapping } from "./tournament-output-adapter"
import { TournamentLabelSchema } from "./tournament-input"

const MAPPING: TournamentLabelMapping = [
  { label: TournamentLabelSchema.parse("entry-001"), candidate_id: CandidateIdSchema.parse("direct-01") },
  { label: TournamentLabelSchema.parse("entry-002"), candidate_id: CandidateIdSchema.parse("construction-01") },
  { label: TournamentLabelSchema.parse("entry-003"), candidate_id: CandidateIdSchema.parse("contradiction-01") },
]

describe("tournament output adapter", () => {
  test("accepts one KEEP and records every other admitted candidate as DROP", () => {
    // given
    const raw = decided([
      action("entry-001", "KEEP"),
      action("entry-002", "DROP"),
      action("entry-003", "DROP"),
    ], null)

    // when
    const result = adaptTournamentOutput(raw, MAPPING)

    // then
    expect(result).toMatchObject({ ok: true, result: {
      kind: "DECIDED",
      actions: [
        { candidate_id: "direct-01", action: "KEEP" },
        { candidate_id: "construction-01", action: "DROP" },
        { candidate_id: "contradiction-01", action: "DROP" },
      ],
      synthesis_brief: null,
      synthesis_brief_sha256: null,
    } })
  })

  test("accepts one lineage-only merge directive and hashes the exact brief", () => {
    // given
    const brief = "Combine the reduction with the construction exactly."
    const raw = decided([
      action("entry-001", "MERGE_IDEA"),
      action("entry-002", "MERGE_IDEA"),
      action("entry-003", "DROP"),
    ], brief)

    // when
    const result = adaptTournamentOutput(raw, MAPPING)

    // then
    expect(result).toMatchObject({ ok: true, result: {
      kind: "DECIDED",
      synthesis_brief: brief,
      synthesis_brief_sha256: sha256(brief),
    } })
  })

  test("accepts only the empty overall NEEDS_HUMAN shape", () => {
    // given
    const valid = JSON.stringify({ kind: "NEEDS_HUMAN" })
    const invalid = JSON.stringify({ kind: "NEEDS_HUMAN", actions: [] })

    // when
    const accepted = adaptTournamentOutput(valid, MAPPING)
    const rejected = adaptTournamentOutput(invalid, MAPPING)

    // then
    expect(accepted).toEqual({ ok: true, result: { kind: "NEEDS_HUMAN" } })
    expect(rejected.ok).toBe(false)
  })

  test("rejects multiple or mixed winners, unknown and missing labels, and duplicate root fields", () => {
    // given
    const invalid = [
      decided([action("entry-001", "KEEP"), action("entry-002", "KEEP"), action("entry-003", "DROP")], null),
      decided([action("entry-001", "KEEP"), action("entry-002", "MERGE_IDEA"), action("entry-003", "DROP")], "Merge."),
      decided([action("entry-001", "KEEP"), action("entry-002", "DROP")], null),
      decided([action("entry-001", "KEEP"), action("entry-002", "DROP"), action("entry-999", "DROP")], null),
      "{\"kind\":\"NEEDS_HUMAN\",\"kind\":\"NEEDS_HUMAN\"}",
    ]

    // when
    const results = invalid.map((raw) => adaptTournamentOutput(raw, MAPPING))

    // then
    expect(results.every((result) => !result.ok)).toBe(true)
  })

  test("rejects a duplicate action key inside an array object", () => {
    // given
    const raw = "{\"kind\":\"DECIDED\",\"actions\":[{\"label\":\"entry-001\",\"action\":\"DROP\",\"action\":\"KEEP\"},{\"label\":\"entry-002\",\"action\":\"DROP\"},{\"label\":\"entry-003\",\"action\":\"DROP\"}],\"synthesis_brief\":null}"

    // when
    const result = adaptTournamentOutput(raw, MAPPING)

    // then
    expect(result).toMatchObject({ ok: false, error: { code: "DUPLICATE_FIELD" } })
  })

  test("rejects numeric and semantic fields, parent IDs, malformed JSON, and Markdown wrappers", () => {
    // given
    const base = JSON.parse(decided([
      action("entry-001", "KEEP"), action("entry-002", "DROP"), action("entry-003", "DROP"),
    ], null))
    const invalid = [
      ...["score", "rank", "probability"].map((field) => JSON.stringify({ ...base, [field]: 1 })),
      ...["proof", "certificate", "witness", "verification"].map((field) => JSON.stringify({ ...base, [field]: {} })),
      JSON.stringify({ ...base, parent_candidate_ids: ["direct-01", "construction-01"] }),
      "not-json",
      `\`\`\`json\n${JSON.stringify(base)}\n\`\`\``,
    ]

    // when
    const results = invalid.map((raw) => adaptTournamentOutput(raw, MAPPING))

    // then
    expect(results.every((result) => !result.ok)).toBe(true)
  })
})

function action(label: string, tournamentAction: "KEEP" | "DROP" | "MERGE_IDEA") {
  return { label, action: tournamentAction }
}

function decided(actions: readonly object[], synthesisBrief: string | null): string {
  return JSON.stringify({ kind: "DECIDED", actions, synthesis_brief: synthesisBrief })
}
