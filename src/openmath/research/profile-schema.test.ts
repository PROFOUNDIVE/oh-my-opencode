import { describe, expect, test } from "bun:test"

import { OpenMathConfigSchema } from "../../config/schema"

const workflow = {
  solve: { agent: "solver", prompt: { kind: "inline", content: "solve" }, output_adapter: "opaque_markdown" },
  review: { agent: "reviewer", prompt: { kind: "inline", content: "review" }, output_adapter: "review_verdict_markdown" },
  revise: { agent: "reviser", prompt: { kind: "inline", content: "revise" }, output_adapter: "full_replace_markdown" },
  min_review_rounds: 1,
  max_review_rounds: 2,
  required_consecutive_passes: 1,
  checkpoint: "after_solve",
}

const strategies = [
  { id: "direct", prompt: { kind: "inline", content: "direct" } },
  { id: "contradiction", prompt: { kind: "inline", content: "contradiction" } },
]

const profile = {
  candidate_workflow_profile: "candidate",
  strategies,
  candidates_per_strategy: 2,
  screening_roles: [
    { id: "screen-a", agent: "reviewer", prompt: { kind: "inline", content: "screen" } },
  ],
  max_active_candidates: 2,
  survivor_limit: 2,
  tournament_role: { agent: "judge", prompt: { kind: "inline", content: "judge" } },
}

function parse(value: object) {
  return OpenMathConfigSchema.safeParse({
    workflow_profiles: { candidate: workflow },
    research_profiles: { "phase-a": value },
  })
}

describe("Phase A research profile schema", () => {
  test("rejects duplicate strategy and screening role IDs at the repeated IDs", () => {
    const result = parse({
      ...profile,
      strategies: [strategies[0], strategies[0]],
      screening_roles: [profile.screening_roles[0], profile.screening_roles[0]],
    })
    const paths = result.success ? [] : result.error.issues.map((issue) => issue.path)

    expect(result.success).toBe(false)
    expect(paths).toContainEqual(["research_profiles", "phase-a", "strategies", 1, "id"])
    expect(paths).toContainEqual(["research_profiles", "phase-a", "screening_roles", 1, "id"])
  })

  test("reports the total candidate overflow independently of the per-strategy bound", () => {
    const result = parse({ ...profile, candidates_per_strategy: 17 })
    const issue = result.success
      ? undefined
      : result.error.issues.find((candidate) => candidate.message === "Maximum total candidates is 32")

    expect(result.success).toBe(false)
    expect(issue?.path).toEqual(["research_profiles", "phase-a", "candidates_per_strategy"])
  })

  test.each([
    { ...profile, strategies: [strategies[0]] },
    { ...profile, strategies: Array.from({ length: 9 }, (_, index) => ({ id: `strategy-${index}`, prompt: { kind: "inline", content: `${index}` } })) },
    { ...profile, candidates_per_strategy: 0 },
    { ...profile, candidates_per_strategy: 5 },
    { ...profile, screening_roles: [] },
    { ...profile, screening_roles: Array.from({ length: 5 }, (_, index) => ({ id: `screen-${index}`, agent: "reviewer", prompt: { kind: "inline", content: `${index}` } })) },
    { ...profile, max_active_candidates: 0 },
    { ...profile, max_active_candidates: 5 },
    { ...profile, survivor_limit: 0 },
    { ...profile, survivor_limit: 5 },
  ])("rejects an invalid Phase A bound", (invalidProfile: object) => {
    expect(parse(invalidProfile).success).toBe(false)
  })

  test("rejects unstable strategy IDs and arbitrary prompt source kinds", () => {
    const invalidId = parse({
      ...profile,
      strategies: [{ id: "not stable", prompt: { kind: "inline", content: "one" } }, strategies[1]],
    })
    const arbitrarySource = parse({
      ...profile,
      strategies: [{ id: "direct", prompt: { kind: "command", command: "run" } }, strategies[1]],
    })

    expect(invalidId.success).toBe(false)
    expect(arbitrarySource.success).toBe(false)
  })

  test("requires exactly one tournament role", () => {
    const missing = parse({ ...profile, tournament_role: undefined })
    const multiple = parse({ ...profile, tournament_roles: [profile.tournament_role] })

    expect(missing.success).toBe(false)
    expect(multiple.success).toBe(false)
  })

  test.each(["obligations", "counterexample", "formal_verifier", "independence_group", "novelty"])(
    "rejects forbidden Phase B-D key %s",
    (key: "obligations" | "counterexample" | "formal_verifier" | "independence_group" | "novelty") => {
      const result = parse({ ...profile, [key]: {} })
      const issue = result.success ? undefined : result.error.issues[0]

      expect(result.success).toBe(false)
      expect(issue?.path).toEqual(["research_profiles", "phase-a"])
    },
  )
})
