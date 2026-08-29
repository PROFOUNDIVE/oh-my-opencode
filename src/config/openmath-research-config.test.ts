import { describe, expect, test } from "bun:test"

import { OpenMathConfigSchema } from "./schema"

const WORKFLOW_PROFILE = {
  solve: { agent: "solver", prompt: { kind: "inline", content: "solve" }, output_adapter: "opaque_markdown" },
  review: { agent: "reviewer", prompt: { kind: "inline", content: "review" }, output_adapter: "review_verdict_markdown" },
  revise: { agent: "reviser", prompt: { kind: "inline", content: "revise" }, output_adapter: "full_replace_markdown" },
  min_review_rounds: 1,
  max_review_rounds: 2,
  required_consecutive_passes: 1,
  checkpoint: "after_solve",
}

const RESEARCH_PROFILE = {
  candidate_workflow_profile: "candidate",
  strategies: [
    { id: "direct", prompt: { kind: "inline", content: "direct strategy" } },
    { id: "contradiction", prompt: { kind: "inline", content: "contradiction strategy" } },
  ],
  candidates_per_strategy: 2,
  screening_roles: [
    { id: "screen-a", agent: "reviewer", prompt: { kind: "inline", content: "screen" } },
  ],
  max_active_candidates: 3,
  survivor_limit: 2,
  tournament_role: {
    agent: "judge",
    model: "openai/judge",
    variant: "high",
    prompt: { kind: "inline", content: "tournament" },
  },
}

describe("OpenMath research config", () => {
  test("preserves the exact legacy value when research fields are absent", () => {
    const before = OpenMathConfigSchema.parse({})

    expect(before).toEqual({
      max_review_rounds: 3,
      max_consecutive_patch_failures: 2,
      artifacts: { format: "markdown" },
      workflow_profiles: {},
      workflow_allowed_roots: ["."],
      state_filename_mode: "linux",
    })
    expect("research_profiles" in before).toBe(false)
    expect("default_research_profile" in before).toBe(false)
  })

  test("accepts a strict Phase A profile referencing a configured workflow", () => {
    const result = OpenMathConfigSchema.safeParse({
      workflow_profiles: { candidate: WORKFLOW_PROFILE },
      research_profiles: { "phase-a": RESEARCH_PROFILE },
      default_research_profile: "phase-a",
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.research_profiles?.["phase-a"]?.candidate_workflow_profile).toBe("candidate")
    }
  })

  test("rejects a missing candidate workflow profile at its exact path", () => {
    const result = OpenMathConfigSchema.safeParse({
      research_profiles: { "phase-a": RESEARCH_PROFILE },
    })
    const issue = result.success ? undefined : result.error.issues[0]

    expect(result.success).toBe(false)
    expect(issue?.path).toEqual(["research_profiles", "phase-a", "candidate_workflow_profile"])
  })

  test("rejects a role variant without an explicit model", () => {
    const result = OpenMathConfigSchema.safeParse({
      workflow_profiles: { candidate: WORKFLOW_PROFILE },
      research_profiles: {
        "phase-a": {
          ...RESEARCH_PROFILE,
          screening_roles: [{
            ...RESEARCH_PROFILE.screening_roles[0],
            variant: "high",
          }],
        },
      },
    })
    const issue = result.success ? undefined : result.error.issues[0]

    expect(result.success).toBe(false)
    expect(issue?.path).toEqual(["research_profiles", "phase-a", "screening_roles", 0, "variant"])
  })
})
