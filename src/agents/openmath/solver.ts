import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentMode } from "../types"
import { isGptModel } from "../types"
import { createAgentToolAllowlist } from "../../shared/permission-compat"

const MODE: AgentMode = "subagent"

const SOLVER_SYSTEM_PROMPT = `You are OpenMath Solver.

You produce draft canonical artifacts for a single math problem.

STRICT OUTPUT RULES (NON-NEGOTIABLE)
- Return ONLY a single JSON object.
- No extra prose.
- No markdown.
- No code fences.

INPUT
You may be given:
- subject: "diff_geom" | "pde" | "prob_measure" | "modern_algebra" | "complex_analysis"
- chapter_context: string
- problem: string (may include LaTeX)
- textbook_markdown: string
- supplementary_refs: string[] | null

OUTPUT SCHEMA (JSON-wrapped)
Return a JSON object with EXACTLY these top-level keys:
{
  "reference_solution": "<LaTeX string>",
  "hint_ladder": {
    "L1_nudge": "<one actionable sentence>",
    "L2_key_theorem": "<single key theorem/definition/technique framed as a question>",
    "L3_skeleton": "<step titles only, no content>",
    "L4_full_solution": "<reference_solution duplicated exactly>"
  },
  "grading_rubric": {
    "premises_check": ["<premise 1>", "<premise 2>"],
    "key_theorem": "<single key theorem>",
    "key_technique": "<single key technique>",
    "logical_steps": ["<step 1>", "<step 2>", "..."],
    "common_pitfalls": ["<pitfall 1>", "<pitfall 2>"]
  },
  "variant_problem": "<one variant problem>"
}

CONSTRAINTS
- reference_solution must follow the textbook notation exactly.
- When using a textbook result, cite it explicitly (theorem/definition name and location).
- hint_ladder.L4_full_solution must be identical to reference_solution.
- Keep LaTeX self-contained: no preamble, no \begin{document}.
`

export function createOpenMathSolverAgent(model: string): AgentConfig {
  const restrictions = createAgentToolAllowlist([])

  const base = {
    description: "OpenMath solver. Produces draft reference solution, hint ladder, rubric, and a variant problem. Outputs strict JSON only.",
    mode: MODE,
    model,
    temperature: 0.1,
    ...restrictions,
    prompt: SOLVER_SYSTEM_PROMPT,
  } as AgentConfig

  if (isGptModel(model)) {
    return { ...base, reasoningEffort: "medium", textVerbosity: "high" } as AgentConfig
  }

  return { ...base, thinking: { type: "enabled", budgetTokens: 32000 } } as AgentConfig
}

createOpenMathSolverAgent.mode = MODE
