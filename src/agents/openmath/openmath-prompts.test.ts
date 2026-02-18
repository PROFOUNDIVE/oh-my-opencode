import { describe, test, expect } from "bun:test"
import { createOpenMathSolverAgent } from "./solver"
import { createOpenMathReferenceReviewerAgent } from "./reference-reviewer"
import { createOpenMathCoachAgent } from "./coach"
import { createOpenMathVerifierAgent } from "./verifier"

const TEST_MODEL = "openai/gpt-5.2"

describe("OpenMath agent factories", () => {
  test("should configure all OpenMath agents as subagents with no tools allowed", () => {
    //#given
    const solver = createOpenMathSolverAgent(TEST_MODEL)
    const reviewer = createOpenMathReferenceReviewerAgent(TEST_MODEL)
    const coach = createOpenMathCoachAgent(TEST_MODEL)
    const verifier = createOpenMathVerifierAgent(TEST_MODEL)

    //#when / #then
    expect(solver.mode).toBe("subagent")
    expect(reviewer.mode).toBe("subagent")
    expect(coach.mode).toBe("subagent")
    expect(verifier.mode).toBe("subagent")

    expect(solver.permission?.["*"]).toBe("deny")
    expect(reviewer.permission?.["*"]).toBe("deny")
    expect(coach.permission?.["*"]).toBe("deny")
    expect(verifier.permission?.["*"]).toBe("deny")
  })
})

describe("OpenMath prompt invariants", () => {
  test("solver prompt should require strict JSON-only output and artifact keys", () => {
    //#given
    const agent = createOpenMathSolverAgent(TEST_MODEL)

    //#when
    const lowerPrompt = agent.prompt.toLowerCase()

    //#then
    expect(lowerPrompt).toContain("return only a single json object")
    expect(lowerPrompt).toContain("no extra prose")
    expect(lowerPrompt).toContain("no markdown")
    expect(lowerPrompt).toContain("no code fences")
    expect(agent.prompt).toContain("\"reference_solution\"")
    expect(agent.prompt).toContain("\"hint_ladder\"")
    expect(agent.prompt).toContain("\"grading_rubric\"")
    expect(agent.prompt).toContain("\"variant_problem\"")
    expect(agent.prompt).toContain("\"L1_nudge\"")
    expect(agent.prompt).toContain("\"L4_full_solution\"")
    expect(agent.prompt).toContain("\"premises_check\"")
  })

  test("reference reviewer prompt should enforce verdict enum and max 3 blocking issues", () => {
    //#given
    const agent = createOpenMathReferenceReviewerAgent(TEST_MODEL)

    //#when
    const lowerPrompt = agent.prompt.toLowerCase()

    //#then
    expect(lowerPrompt).toContain("\"[correct]\"")
    expect(lowerPrompt).toContain("\"[error]\"")
    expect(lowerPrompt).toContain("\"[inconclusive]\"")
    expect(lowerPrompt).toContain("at most 3 blocking issues")
    expect(lowerPrompt).toContain("no extra prose")
    expect(agent.prompt).toContain("\"checks_performed\"")
    expect(agent.prompt).toContain("\"certificate\"")
    expect(agent.prompt).toContain("\"fix_direction\"")
  })

  test("coach prompt should fail-closed unless artifacts are FROZEN with a [CORRECT] certificate", () => {
    //#given
    const agent = createOpenMathCoachAgent(TEST_MODEL)

    //#when
    const prompt = agent.prompt
    const lowerPrompt = prompt.toLowerCase()

    //#then
    expect(lowerPrompt).toContain("artifact_state must be frozen")
    expect(prompt).toContain("review_certificate.verdict must be [CORRECT]")
    expect(lowerPrompt).toMatch(/do not reveal.*hints_used.*hint_budget.*explicitly asks/i)
    expect(lowerPrompt).toContain("no extra prose")
    expect(prompt).toContain("\"response_type\"")
  })

  test("verifier prompt should require exactly 1 error-driven Anki card", () => {
    //#given
    const agent = createOpenMathVerifierAgent(TEST_MODEL)

    //#when
    const lowerPrompt = agent.prompt.toLowerCase()

    //#then
    expect(lowerPrompt).toContain("exactly one error-driven anki card")
    expect(lowerPrompt).toContain("return only a single json object")
    expect(lowerPrompt).toContain("anki_card_suggestion")
  })
})
