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

type HintLadderFields = {
  L1_nudge: string
  L2_key_theorem: string
  L3_skeleton: string[]
}

function extractHintLadderFields(hintLadder: Record<string, unknown>): HintLadderFields | null {
  const L1_nudge = asString(hintLadder.L1_nudge)
  const L2_key_theorem = asString(hintLadder.L2_key_theorem)
  const L3_skeleton = asStringList(hintLadder.L3_skeleton)

  if (!L1_nudge || !L2_key_theorem || !L3_skeleton || L3_skeleton.length === 0) {
    return null
  }

  return { L1_nudge, L2_key_theorem, L3_skeleton }
}

export function renderStudentHintLadderMarkdown(hintLadder: Record<string, unknown>): string {
  const extracted = extractHintLadderFields(hintLadder)
  if (!extracted) {
    return ["## Hint ladder", "", "```json", stableJson(hintLadder), "```", ""].join("\n")
  }

  return [
    "## Hint ladder",
    "",
    "### L1_nudge",
    extracted.L1_nudge.trimEnd(),
    "",
    "### L2_key_theorem",
    extracted.L2_key_theorem.trimEnd(),
    "",
    "### L3_skeleton",
    ...extracted.L3_skeleton.map((x) => `- ${x}`),
    "",
  ].join("\n")
}
