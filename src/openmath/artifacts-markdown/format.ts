import type {
  OpenMathArtifactsDraft,
  OpenMathArtifactsSectionId,
  OpenMathReferenceSolutionSentinel,
} from "./types"

const SECTION_ORDER: OpenMathArtifactsSectionId[] = [
  "reference_solution",
  "hint_ladder",
  "grading_rubric",
  "variant_problem",
]

function normalizeMarkdownLines(input: string): string[] {
  const lf = input.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
  return lf.split("\n").map((line) => line.replace(/[\t ]+$/g, ""))
}

function normalizeScalarBlock(input: string): string {
  const lines = normalizeMarkdownLines(input)
  while (lines.length > 0 && lines[0].trim() === "") lines.shift()
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop()
  return lines.join("\n")
}

function normalizeBulletItems(items: string[], label: string): string[] {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error(`${label} must be a non-empty list`)
  }

  return items.map((item, idx) => {
    if (typeof item !== "string") {
      throw new Error(`${label}[${idx}] must be a string`)
    }
    const normalized = normalizeScalarBlock(item)
    if (normalized.includes("\n")) {
      throw new Error(`${label}[${idx}] must be a single line`)
    }
    if (normalized.trim() === "") {
      throw new Error(`${label}[${idx}] must not be empty`)
    }
    return normalized
  })
}

function formatSectionStart(id: OpenMathArtifactsSectionId): string {
  return `<!-- OMO:SECTION ${id} -->`
}

function formatSectionEnd(): string {
  return "<!-- OMO:ENDSECTION -->"
}

function ensureSingleTrailingNewline(markdown: string): string {
  const normalized = normalizeMarkdownLines(markdown).join("\n")
  const stripped = normalized.replace(/\n+$/g, "")
  return `${stripped}\n`
}

function formatHintLadder(draft: OpenMathArtifactsDraft): string {
  const L1_nudge = normalizeScalarBlock(draft.hint_ladder.L1_nudge)
  const L2_key_theorem = normalizeScalarBlock(draft.hint_ladder.L2_key_theorem)
  const L3_skeleton = normalizeBulletItems(draft.hint_ladder.L3_skeleton, "hint_ladder.L3_skeleton")

  const ref = normalizeScalarBlock(draft.reference_solution)
  const L4_raw = draft.hint_ladder.L4_full_solution
  const L4 = normalizeScalarBlock(String(L4_raw))
  const L4_isSentinel: boolean = L4 === ("@REFERENCE_SOLUTION" satisfies OpenMathReferenceSolutionSentinel)

  if (!L4_isSentinel && L4 !== ref) {
    throw new Error(
      "hint_ladder.L4_full_solution must be '@REFERENCE_SOLUTION' or match reference_solution exactly",
    )
  }

  const L4_out = "@REFERENCE_SOLUTION"

  const parts: string[] = []
  parts.push("### L1_nudge", L1_nudge, "")
  parts.push("### L2_key_theorem", L2_key_theorem, "")
  parts.push("### L3_skeleton", ...L3_skeleton.map((x) => `- ${x}`), "")
  parts.push("### L4_full_solution", L4_out)
  return parts.join("\n")
}

function formatGradingRubric(draft: OpenMathArtifactsDraft): string {
  const premises_check = normalizeBulletItems(
    draft.grading_rubric.premises_check,
    "grading_rubric.premises_check",
  )
  const logical_steps = normalizeBulletItems(
    draft.grading_rubric.logical_steps,
    "grading_rubric.logical_steps",
  )
  const common_pitfalls = normalizeBulletItems(
    draft.grading_rubric.common_pitfalls,
    "grading_rubric.common_pitfalls",
  )
  const key_theorem = normalizeScalarBlock(draft.grading_rubric.key_theorem)
  const key_technique = normalizeScalarBlock(draft.grading_rubric.key_technique)

  const parts: string[] = []
  parts.push("### premises_check", ...premises_check.map((x) => `- ${x}`), "")
  parts.push("### logical_steps", ...logical_steps.map((x) => `- ${x}`), "")
  parts.push("### common_pitfalls", ...common_pitfalls.map((x) => `- ${x}`), "")
  parts.push("### key_theorem", key_theorem, "")
  parts.push("### key_technique", key_technique)
  return parts.join("\n")
}

export function formatOpenMathArtifactsMarkdown(draft: OpenMathArtifactsDraft): string {
  const reference_solution = normalizeScalarBlock(draft.reference_solution)
  const variant_problem = normalizeScalarBlock(draft.variant_problem)

  if (reference_solution.trim() === "") throw new Error("reference_solution must not be empty")
  if (variant_problem.trim() === "") throw new Error("variant_problem must not be empty")

  const sectionContent: Record<OpenMathArtifactsSectionId, string> = {
    reference_solution,
    hint_ladder: formatHintLadder(draft),
    grading_rubric: formatGradingRubric(draft),
    variant_problem,
  }

  const outLines: string[] = []
  for (const id of SECTION_ORDER) {
    outLines.push(formatSectionStart(id))
    outLines.push(sectionContent[id])
    outLines.push(formatSectionEnd())
  }

  return ensureSingleTrailingNewline(outLines.join("\n"))
}
