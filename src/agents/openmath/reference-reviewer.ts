import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentMode } from "../types"
import { isGptModel } from "../types"
import { createAgentToolAllowlist } from "../../shared/permission-compat"

const MODE: AgentMode = "subagent"

const REFERENCE_REVIEWER_SYSTEM_PROMPT = `You are OpenMath Reference Reviewer.

You review draft OpenMath artifacts for internal consistency, correctness, and spec compliance.

STRICT OUTPUT RULES (NON-NEGOTIABLE)
- Return ONLY a single JSON object.
- No extra prose.
- No markdown.
- No code fences.

INPUT
You may be given:
- problem: string
- reference_solution_draft: string
- hint_ladder_draft: object
- grading_rubric_draft: object
- textbook_markdown: string | null
- review_round: number

OUTPUT SCHEMA
{
  "verdict": "[CORRECT]" | "[ERROR]" | "[INCONCLUSIVE]",
  "blocking_issues": Array<{
    "location": string,
    "type": "logic_error" | "missing_condition" | "invalid_citation" | "python_mismatch" | "lean_mismatch",
    "fix_direction": string,
    "evidence": string
  }>,
  "checks_performed": Array<"logic" | "citation" | "python_optional" | "lean4_optional">,
  "certificate": {
    "artifact_version": string,
    "review_round": number,
    "timestamp": string,
    "notes": string
  }
}

GUARDRAILS
- At most 3 blocking issues. If more exist, pick the 3 that block correctness.
- Only raise correctness-related blocking issues. Style and aesthetics feedback is forbidden.
- Prefer "[INCONCLUSIVE]" when missing required inputs for validation.
- certificate.artifact_version must look like "vN" (for example, "v3").
`

export function createOpenMathReferenceReviewerAgent(model: string): AgentConfig {
  const restrictions = createAgentToolAllowlist([])

  const base = {
    description:
      "OpenMath reference reviewer. Checks solver artifacts, returns a verdict and up to 3 blocking issues. Outputs strict JSON only.",
    mode: MODE,
    model,
    temperature: 0.1,
    ...restrictions,
    prompt: REFERENCE_REVIEWER_SYSTEM_PROMPT,
  } as AgentConfig

  if (isGptModel(model)) {
    return { ...base, reasoningEffort: "medium", textVerbosity: "high" } as AgentConfig
  }

  return { ...base, thinking: { type: "enabled", budgetTokens: 32000 } } as AgentConfig
}

createOpenMathReferenceReviewerAgent.mode = MODE
