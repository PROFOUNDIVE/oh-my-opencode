import { describe, test, expect } from "bun:test"
import { createOpenMathSolverAgent } from "./solver"
import { createOpenMathSolverMarkdownAgent } from "./solver-markdown"
import { createOpenMathReferenceReviewerAgent } from "./reference-reviewer"
import { createOpenMathReferenceReviewerPatchAgent } from "./reference-reviewer-patch"
import { createOpenMathCoachAgent } from "./coach"
import { createOpenMathVerifierAgent } from "./verifier"

const TEST_MODEL = "openai/gpt-5.2"

function requirePrompt(agent: { prompt?: string }): string {
  const prompt = agent.prompt ?? ""
  expect(prompt).not.toBe("")
  return prompt
}

describe("OpenMath agent factories", () => {
  test("should configure all OpenMath agents as subagents with no tools allowed", () => {
    //#given
    const solver = createOpenMathSolverAgent(TEST_MODEL)
    const solverMarkdown = createOpenMathSolverMarkdownAgent(TEST_MODEL)
    const reviewer = createOpenMathReferenceReviewerAgent(TEST_MODEL)
    const reviewerPatch = createOpenMathReferenceReviewerPatchAgent(TEST_MODEL)
    const coach = createOpenMathCoachAgent(TEST_MODEL)
    const verifier = createOpenMathVerifierAgent(TEST_MODEL)

    //#when / #then
    expect(solver.mode).toBe("subagent")
    expect(solverMarkdown.mode).toBe("subagent")
    expect(reviewer.mode).toBe("subagent")
    expect(reviewerPatch.mode).toBe("subagent")
    expect(coach.mode).toBe("subagent")
    expect(verifier.mode).toBe("subagent")

    expect(solver.permission?.["*"]).toBe("deny")
    expect(solverMarkdown.permission?.["*"]).toBe("deny")
    expect(reviewer.permission?.["*"]).toBe("deny")
    expect(reviewerPatch.permission?.["*"]).toBe("deny")
    expect(coach.permission?.["*"]).toBe("deny")
    expect(verifier.permission?.["*"]).toBe("deny")
  })
})

describe("OpenMath prompt invariants", () => {
  test("solver prompt should require strict JSON-only output and artifact keys", () => {
    //#given
    const agent = createOpenMathSolverAgent(TEST_MODEL)

    //#when
    const prompt = requirePrompt(agent)
    const lowerPrompt = prompt.toLowerCase()

    //#then
    expect(lowerPrompt).toContain("return only a single json object")
    expect(lowerPrompt).toContain("no extra prose")
    expect(lowerPrompt).toContain("no markdown")
    expect(lowerPrompt).toContain("no code fences")
    expect(prompt).toContain("\"reference_solution\"")
    expect(prompt).toContain("\"hint_ladder\"")
    expect(prompt).toContain("\"grading_rubric\"")
    expect(prompt).toContain("\"variant_problem\"")
    expect(prompt).toContain("\"L1_nudge\"")
    expect(prompt).toContain("\"L4_full_solution\"")
    expect(prompt).toContain("\"premises_check\"")
  })

  test("solver-markdown prompt should require OMO:SECTION markers and must not be JSON-only", () => {
    //#given
    const agent = createOpenMathSolverMarkdownAgent(TEST_MODEL)

    //#when
    const prompt = requirePrompt(agent)
    const lowerPrompt = prompt.toLowerCase()

    //#then
    expect(prompt).toContain("<!-- OMO:SECTION reference_solution -->")
    expect(prompt).toContain("<!-- OMO:SECTION hint_ladder -->")
    expect(prompt).toContain("<!-- OMO:SECTION grading_rubric -->")
    expect(prompt).toContain("<!-- OMO:SECTION variant_problem -->")
    expect(lowerPrompt).not.toContain("return only a single json object")
    expect(lowerPrompt).not.toContain("no markdown")
  })

  test("reference reviewer prompt should enforce verdict enum and max 3 blocking issues", () => {
    //#given
    const agent = createOpenMathReferenceReviewerAgent(TEST_MODEL)

    //#when
    const prompt = requirePrompt(agent)
    const lowerPrompt = prompt.toLowerCase()

    //#then
    expect(lowerPrompt).toContain("\"[correct]\"")
    expect(lowerPrompt).toContain("\"[error]\"")
    expect(lowerPrompt).toContain("\"[inconclusive]\"")
    expect(lowerPrompt).toContain("at most 3 blocking issues")
    expect(lowerPrompt).toContain("no extra prose")
    expect(prompt).toContain("\"checks_performed\"")
    expect(prompt).toContain("\"certificate\"")
    expect(prompt).toContain("\"fix_direction\"")
  })

  test("reference-reviewer-patch prompt should require base_hash pinning", () => {
    //#given
    const agent = createOpenMathReferenceReviewerPatchAgent(TEST_MODEL)

    //#when
    const prompt = requirePrompt(agent)
    const lowerPrompt = prompt.toLowerCase()

    //#then
    expect(lowerPrompt).toContain("base_hash must equal")
    expect(lowerPrompt).toContain("patch_set.base_hash")
  })

  test("reference-reviewer-patch prompt should document patch op schema", () => {
    //#given
    const agent = createOpenMathReferenceReviewerPatchAgent(TEST_MODEL)

    const prompt = requirePrompt(agent)

    //#then
    expect(prompt).toContain("\"op\": \"replace_section\"")
    expect(prompt).toContain("\"op\": \"replace_unique_substring\"")
    expect(prompt).toContain("\"section_id\"")
    expect(prompt).toContain("\"new_content\"")
    expect(prompt).toContain("\"base_hash\"")
  })

  test("coach prompt should fail-closed unless artifacts are FROZEN with a [CORRECT] certificate", () => {
    //#given
    const agent = createOpenMathCoachAgent(TEST_MODEL)

    //#when
    const prompt = requirePrompt(agent)
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
    const prompt = requirePrompt(agent)
    const lowerPrompt = prompt.toLowerCase()

    //#then
    expect(lowerPrompt).toContain("exactly one error-driven anki card")
    expect(lowerPrompt).toContain("return only a single json object")
    expect(lowerPrompt).toContain("anki_card_suggestion")
  })
})
