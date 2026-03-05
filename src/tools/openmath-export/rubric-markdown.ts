import { stableJson } from "./stable-json"

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null
}

function asStringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null
  }
  const out: string[] = []
  for (const item of value) {
    if (typeof item !== "string") {
      return null
    }
    out.push(item)
  }
  return out
}

type RubricFields = {
  key_theorem?: string
  key_technique?: string
  premises_check?: string[]
  logical_steps?: string[]
  common_pitfalls?: string[]
}

function extractRubricFields(gradingRubric: Record<string, unknown>): RubricFields | null {
  const key_theorem = asString(gradingRubric.key_theorem)
  const key_technique = asString(gradingRubric.key_technique)
  const premises_check = asStringList(gradingRubric.premises_check)
  const logical_steps = asStringList(gradingRubric.logical_steps)
  const common_pitfalls = asStringList(gradingRubric.common_pitfalls)

  const hasAny = Boolean(key_theorem || key_technique || premises_check || logical_steps || common_pitfalls)
  if (!hasAny) {
    return null
  }

  return {
    key_theorem: key_theorem ?? undefined,
    key_technique: key_technique ?? undefined,
    premises_check: premises_check ?? undefined,
    logical_steps: logical_steps ?? undefined,
    common_pitfalls: common_pitfalls ?? undefined,
  }
}

function renderBullets(items: string[]): string {
  return items.map((item) => `- ${item}`).join("\n")
}

export function renderStudentRubric(gradingRubric: Record<string, unknown>): string {
  const extracted = extractRubricFields(gradingRubric)
  if (!extracted) {
    return [
      "## Grading rubric (simplified)",
      "",
      "```json",
      stableJson(gradingRubric),
      "```",
      "",
    ].join("\n")
  }

  const parts: string[] = ["## Grading rubric (simplified)", ""]

  if (extracted.key_theorem) {
    parts.push(`- Key theorem: ${extracted.key_theorem}`)
  }
  if (extracted.key_technique) {
    parts.push(`- Key technique: ${extracted.key_technique}`)
  }

  if (extracted.logical_steps && extracted.logical_steps.length > 0) {
    parts.push("", "### Logical steps", renderBullets(extracted.logical_steps))
  }

  parts.push("")
  return parts.join("\n")
}

export function renderTeacherRubric(gradingRubric: Record<string, unknown>): string {
  const extracted = extractRubricFields(gradingRubric)
  if (!extracted) {
    return ["## Grading rubric (full)", "", "```json", stableJson(gradingRubric), "```", ""].join("\n")
  }

  const parts: string[] = ["## Grading rubric (full)", ""]
  if (extracted.key_theorem) {
    parts.push(`- Key theorem: ${extracted.key_theorem}`)
  }
  if (extracted.key_technique) {
    parts.push(`- Key technique: ${extracted.key_technique}`)
  }

  if (extracted.premises_check && extracted.premises_check.length > 0) {
    parts.push("", "### Premises check", renderBullets(extracted.premises_check))
  }

  if (extracted.logical_steps && extracted.logical_steps.length > 0) {
    parts.push("", "### Logical steps", renderBullets(extracted.logical_steps))
  }

  if (extracted.common_pitfalls && extracted.common_pitfalls.length > 0) {
    parts.push("", "### Common pitfalls", renderBullets(extracted.common_pitfalls))
  }

  parts.push("")
  return parts.join("\n")
}
