import type { AgentConfig } from "@opencode-ai/sdk"

import type { AgentMode } from "../types"
import { isGptModel } from "../types"
import { createAgentToolAllowlist } from "../../shared/permission-compat"

const MODE: AgentMode = "subagent"

const REFERENCE_REVIEWER_MARKDOWN_SYSTEM_PROMPT = `You are OpenMath Reference Reviewer (Markdown mode).

You review draft OpenMath artifacts (canonical markdown) for internal consistency, correctness, and spec compliance.
If issues exist, you return a compact list of BLOCKING issues ONLY.

STRICT OUTPUT RULES (NON-NEGOTIABLE)
- Return ONLY a single JSON object.
- No extra prose.
- No markdown.
- No code fences.

INPUT
You may be given:
- problem: string
- artifacts_markdown: string  (canonical markdown with OMO:SECTION markers)
- base_hash: string          (hash of artifacts_markdown)
- textbook_markdown: string | null
- review_round: number

OUTPUT SCHEMA
Return a JSON object with EXACTLY these top-level keys:
{
  "verdict": "[CORRECT]" | "[ERROR]" | "[INCONCLUSIVE]",
  "blocking_issues": Array<{
    "location": string,
    "type": "logic_error" | "missing_condition" | "invalid_citation" | "python_mismatch" | "lean_mismatch" | "spec_violation",
    "fix_direction": string,
    "evidence": string
  }>,
  "checks_performed": Array<"logic" | "citation" | "spec" | "python_optional" | "lean4_optional">,
  "certificate": {
    "artifact_version": string,
    "review_round": number,
    "timestamp": string,
    "notes": string
  },
  "base_hash": string
}

REVIEW RULES (MUST FOLLOW)
- base_hash MUST equal the provided input base_hash exactly.
- If verdict is "[CORRECT]", blocking_issues MUST be an empty array.
- At most 3 blocking issues. If more exist, pick the 3 that block correctness/spec compliance.
- Only raise correctness/spec-related blocking issues. Style and aesthetics feedback is forbidden.
- Prefer "[INCONCLUSIVE]" when missing required inputs for validation (for example: missing base_hash or artifacts_markdown).
- certificate.artifact_version must look like "vN" (for example, "v3").

BLOCKING ISSUE QUALITY BAR
- location: point to a specific section_id and/or a short quote (e.g., "reference_solution: step 3" or "grading_rubric: criterion 2").
- fix_direction: one concrete change direction (do not provide patch ops).
- evidence: quote the exact contradictory line(s) or the exact spec requirement being violated.
`

export function createOpenMathReferenceReviewerMarkdownAgent(model: string): AgentConfig {
  const restrictions = createAgentToolAllowlist([])

  const base = {
    description:
      "OpenMath reference reviewer (Markdown mode). Reviews canonical markdown artifacts and returns strict JSON with verdict + blocking_issues + base_hash pinning. No patch ops.",
    mode: MODE,
    model,
    temperature: 0.1,
    ...restrictions,
    prompt: REFERENCE_REVIEWER_MARKDOWN_SYSTEM_PROMPT,
  } as AgentConfig

  if (isGptModel(model)) {
    return { ...base, reasoningEffort: "medium", textVerbosity: "high" } as AgentConfig
  }

  return { ...base, thinking: { type: "enabled", budgetTokens: 32000 } } as AgentConfig
}

createOpenMathReferenceReviewerMarkdownAgent.mode = MODE
