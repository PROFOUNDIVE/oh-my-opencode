import type {
  OpenMathArtifactsDraft,
  OpenMathArtifactsParseError,
  OpenMathArtifactsSectionId,
  OpenMathReferenceSolutionSentinel,
} from "./types"

type ParseOk = {
  ok: true
  normalizedMarkdown: string
  draft: OpenMathArtifactsDraft
}

type ParseErr = {
  ok: false
  normalizedMarkdown: string
  error: OpenMathArtifactsParseError
}

export type OpenMathArtifactsParseResult = ParseOk | ParseErr

const SECTION_IDS: OpenMathArtifactsSectionId[] = [
  "reference_solution",
  "hint_ladder",
  "grading_rubric",
  "variant_problem",
]

const SECTION_START_RE = /^<!--\s*OMO:SECTION\s+([a-z0-9_]+)\s*-->$/
const SECTION_END_RE = /^<!--\s*OMO:ENDSECTION\s*-->$/
const SUBSECTION_RE = /^###\s+([A-Za-z0-9_]+)\s*$/

function normalizeMarkdown(markdown: string): string {
  const lf = markdown.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
  const trimmed = lf
    .split("\n")
    .map((line) => line.replace(/[\t ]+$/g, ""))
    .join("\n")
    .replace(/\n+$/g, "")
  return `${trimmed}\n`
}

function parseScalar(
  lines: string[],
  opts: { label: string; lineOffset: number; allowReferenceSentinel?: boolean },
): string {
  const copy = lines.slice()
  while (copy.length > 0 && copy[0].trim() === "") copy.shift()
  while (copy.length > 0 && copy[copy.length - 1].trim() === "") copy.pop()

  if (copy.length === 0) {
    throw new Error(`${opts.label} must not be empty`)
  }
  for (let i = 0; i < copy.length; i++) {
    if (SUBSECTION_RE.test(copy[i])) {
      const line = opts.lineOffset + i
      throw new Error(`${opts.label} contains unexpected subsection header at line ${line}`)
    }
  }
  return copy.join("\n")
}

function parseBullets(lines: string[], label: string): string[] {
  const items: string[] = []
  for (const line of lines) {
    if (line.trim() === "") continue
    if (!line.startsWith("- ")) {
      throw new Error(`${label} must be a bullet list using '- ' lines`)
    }
    const item = line.slice(2).trim()
    if (item === "") throw new Error(`${label} bullet items must not be empty`)
    items.push(item)
  }
  if (items.length === 0) throw new Error(`${label} must contain at least one item`)
  return items
}

function isKnownSectionId(id: string): id is OpenMathArtifactsSectionId {
  return (SECTION_IDS as string[]).includes(id)
}

function parseHintLadderSection(
  lines: string[],
  sectionLine: number,
): OpenMathArtifactsDraft["hint_ladder"] {
  const blocks = new Map<string, { startLine: number; lines: string[] }>()

  let currentKey: string | null = null
  let currentStartLine = sectionLine
  let currentLines: string[] = []

  function flush() {
    if (!currentKey) return
    if (blocks.has(currentKey)) throw new Error(`Duplicate hint_ladder key: ${currentKey}`)
    blocks.set(currentKey, { startLine: currentStartLine, lines: currentLines })
  }

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(SUBSECTION_RE)
    if (m) {
      flush()
      currentKey = m[1]
      currentStartLine = sectionLine + i + 1
      currentLines = []
      continue
    }
    currentLines.push(lines[i])
  }
  flush()

  const required = ["L1_nudge", "L2_key_theorem", "L3_skeleton", "L4_full_solution"]
  for (const k of required) {
    if (!blocks.has(k)) throw new Error(`Missing hint_ladder key: ${k}`)
  }
  if (blocks.size !== required.length) {
    const extra = [...blocks.keys()].filter((k) => !required.includes(k))
    if (extra.length > 0) throw new Error(`Unexpected hint_ladder keys: ${extra.join(", ")}`)
  }

  const L1_nudge = parseScalar(blocks.get("L1_nudge")!.lines, {
    label: "hint_ladder.L1_nudge",
    lineOffset: blocks.get("L1_nudge")!.startLine,
  })
  const L2_key_theorem = parseScalar(blocks.get("L2_key_theorem")!.lines, {
    label: "hint_ladder.L2_key_theorem",
    lineOffset: blocks.get("L2_key_theorem")!.startLine,
  })
  const L3_skeleton = parseBullets(blocks.get("L3_skeleton")!.lines, "hint_ladder.L3_skeleton")
  const L4_block = blocks.get("L4_full_solution")!
  const L4_text = parseScalar(L4_block.lines, {
    label: "hint_ladder.L4_full_solution",
    lineOffset: L4_block.startLine,
  })
  const L4_trimmed = L4_text.trim()
  const sentinel = "@REFERENCE_SOLUTION" satisfies OpenMathReferenceSolutionSentinel
  const L4_full_solution: string | OpenMathReferenceSolutionSentinel =
    L4_trimmed === sentinel ? sentinel : L4_text

  return { L1_nudge, L2_key_theorem, L3_skeleton, L4_full_solution }
}

function parseGradingRubricSection(
  lines: string[],
  sectionLine: number,
): OpenMathArtifactsDraft["grading_rubric"] {
  const blocks = new Map<string, { startLine: number; lines: string[] }>()

  let currentKey: string | null = null
  let currentStartLine = sectionLine
  let currentLines: string[] = []

  function flush() {
    if (!currentKey) return
    if (blocks.has(currentKey)) throw new Error(`Duplicate grading_rubric key: ${currentKey}`)
    blocks.set(currentKey, { startLine: currentStartLine, lines: currentLines })
  }

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(SUBSECTION_RE)
    if (m) {
      flush()
      currentKey = m[1]
      currentStartLine = sectionLine + i + 1
      currentLines = []
      continue
    }
    currentLines.push(lines[i])
  }
  flush()

  const required = [
    "premises_check",
    "logical_steps",
    "common_pitfalls",
    "key_theorem",
    "key_technique",
  ]
  for (const k of required) {
    if (!blocks.has(k)) throw new Error(`Missing grading_rubric key: ${k}`)
  }
  if (blocks.size !== required.length) {
    const extra = [...blocks.keys()].filter((k) => !required.includes(k))
    if (extra.length > 0) throw new Error(`Unexpected grading_rubric keys: ${extra.join(", ")}`)
  }

  const premises_check = parseBullets(
    blocks.get("premises_check")!.lines,
    "grading_rubric.premises_check",
  )
  const logical_steps = parseBullets(
    blocks.get("logical_steps")!.lines,
    "grading_rubric.logical_steps",
  )
  const common_pitfalls = parseBullets(
    blocks.get("common_pitfalls")!.lines,
    "grading_rubric.common_pitfalls",
  )
  const key_theorem = parseScalar(blocks.get("key_theorem")!.lines, {
    label: "grading_rubric.key_theorem",
    lineOffset: blocks.get("key_theorem")!.startLine,
  })
  const key_technique = parseScalar(blocks.get("key_technique")!.lines, {
    label: "grading_rubric.key_technique",
    lineOffset: blocks.get("key_technique")!.startLine,
  })

  return { premises_check, logical_steps, common_pitfalls, key_theorem, key_technique }
}

export function parseOpenMathArtifactsMarkdown(markdown: string): OpenMathArtifactsParseResult {
  const normalizedMarkdown = normalizeMarkdown(markdown)
  const lines = normalizedMarkdown.split("\n")
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop()

  const sections = new Map<OpenMathArtifactsSectionId, { startLine: number; lines: string[] }>()

  let active: { id: OpenMathArtifactsSectionId; startLine: number; lines: string[] } | null = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lineNumber = i + 1

    const startMatch = line.match(SECTION_START_RE)
    const endMatch = line.match(SECTION_END_RE)

    if (!active) {
      if (endMatch) {
        return {
          ok: false,
          normalizedMarkdown,
          error: {
            code: "ENDSECTION_WITHOUT_SECTION",
            message: "Found ENDSECTION marker without an open section",
            line: lineNumber,
          },
        }
      }

      if (startMatch) {
        const rawId = startMatch[1]
        if (!isKnownSectionId(rawId)) {
          return {
            ok: false,
            normalizedMarkdown,
            error: {
              code: "UNKNOWN_SECTION_ID",
              message: `Unknown section id: ${rawId}`,
              line: lineNumber,
            },
          }
        }
        if (sections.has(rawId)) {
          return {
            ok: false,
            normalizedMarkdown,
            error: {
              code: "DUPLICATE_SECTION",
              message: `Duplicate section: ${rawId}`,
              line: lineNumber,
              section: rawId,
            },
          }
        }
        active = { id: rawId, startLine: lineNumber, lines: [] }
        continue
      }

      if (line.trim() !== "") {
        return {
          ok: false,
          normalizedMarkdown,
          error: {
            code: "UNEXPECTED_TEXT_OUTSIDE_SECTIONS",
            message: "Unexpected non-empty text outside any OMO section markers",
            line: lineNumber,
          },
        }
      }

      continue
    }

    if (startMatch) {
      return {
        ok: false,
        normalizedMarkdown,
        error: {
          code: "NESTED_SECTION",
          message: `Nested section start inside section ${active.id}`,
          line: lineNumber,
          section: active.id,
        },
      }
    }

    if (endMatch) {
      sections.set(active.id, { startLine: active.startLine, lines: active.lines })
      active = null
      continue
    }

    active.lines.push(line)
  }

  if (active) {
    return {
      ok: false,
      normalizedMarkdown,
      error: {
        code: "UNCLOSED_SECTION",
        message: `Section ${active.id} was not closed with an ENDSECTION marker`,
        line: active.startLine,
        section: active.id,
      },
    }
  }

  for (const id of SECTION_IDS) {
    if (!sections.has(id)) {
      return {
        ok: false,
        normalizedMarkdown,
        error: {
          code: "MISSING_SECTION",
          message: `Missing required section: ${id}`,
          section: id,
        },
      }
    }
  }

  try {
    const refLines = sections.get("reference_solution")!.lines
    const reference_solution = parseScalar(refLines, {
      label: "reference_solution",
      lineOffset: sections.get("reference_solution")!.startLine,
    })

    const hint_ladder = parseHintLadderSection(
      sections.get("hint_ladder")!.lines,
      sections.get("hint_ladder")!.startLine,
    )

    const grading_rubric = parseGradingRubricSection(
      sections.get("grading_rubric")!.lines,
      sections.get("grading_rubric")!.startLine,
    )

    const variant_problem = parseScalar(sections.get("variant_problem")!.lines, {
      label: "variant_problem",
      lineOffset: sections.get("variant_problem")!.startLine,
    })

    const sentinel = "@REFERENCE_SOLUTION" satisfies OpenMathReferenceSolutionSentinel
    const L4 = hint_ladder.L4_full_solution
    if (L4 !== sentinel && L4 !== reference_solution) {
      return {
        ok: false,
        normalizedMarkdown,
        error: {
          code: "INVALID_SECTION_CONTENT",
          message:
            "hint_ladder.L4_full_solution must be '@REFERENCE_SOLUTION' or match reference_solution exactly",
          section: "hint_ladder",
        },
      }
    }

    return {
      ok: true,
      normalizedMarkdown,
      draft: { reference_solution, hint_ladder, grading_rubric, variant_problem },
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      ok: false,
      normalizedMarkdown,
      error: {
        code: "INVALID_SECTION_CONTENT",
        message,
      },
    }
  }
}
