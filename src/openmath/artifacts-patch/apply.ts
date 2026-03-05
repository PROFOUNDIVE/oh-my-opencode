import { FrozenArtifactsSchema } from "../../tools/openmath-state/types"
import { hashOpenMathArtifactsMarkdown } from "../artifacts-markdown/hash"
import { parseOpenMathArtifactsMarkdown } from "../artifacts-markdown/parse"
import type { OpenMathArtifactsDraft, OpenMathArtifactsSectionId } from "../artifacts-markdown/types"
import { OpenMathArtifactsPatchSetSchema } from "./types"
import type { OpenMathArtifactsPatchOp, OpenMathArtifactsPatchSet } from "./types"

export type OpenMathArtifactsPatchApplyErrorCode =
  | "BASE_HASH_MISMATCH"
  | "TOO_MANY_OPS"
  | "UNKNOWN_SECTION"
  | "DUPLICATE_SECTION_MARKER"
  | "UNCLOSED_SECTION"
  | "UNIQUE_SUBSTRING_DISABLED"
  | "UNIQUE_SUBSTRING_TOO_SHORT"
  | "UNIQUE_SUBSTRING_NOT_FOUND"
  | "UNIQUE_SUBSTRING_NOT_UNIQUE"
  | "PATCH_PARSE_ERROR"
  | "ARTIFACTS_PARSE_ERROR"
  | "DRAFT_VALIDATION_ERROR"

type ApplyOk = {
  ok: true
  markdown: string
  hash: string
  draft: OpenMathArtifactsDraft
}

type ApplyErr = {
  ok: false
  error_code: OpenMathArtifactsPatchApplyErrorCode
  details?: unknown
}

export type ApplyOpenMathArtifactsPatchResult = ApplyOk | ApplyErr

type ApplyOpts = {
  max_ops?: number
  allow_unique_substring_replace?: boolean
}

const PLACEHOLDER_CERTIFICATE = {
  artifact_version: "v1",
  review_round: 1,
  timestamp: "1970-01-01T00:00:00.000Z",
  verdict: "[INCONCLUSIVE]" as const,
  notes: "DRAFT",
}

function normalizeMarkdown(markdown: string): string {
  const lf = markdown.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
  const trimmed = lf
    .split("\n")
    .map((line) => line.replace(/[\t ]+$/g, ""))
    .join("\n")
    .replace(/\n+$/g, "")
  return `${trimmed}\n`
}

function normalizeBlockContent(block: string): string[] {
  const lf = block.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
  const trimmedLines = lf.split("\n").map((line) => line.replace(/[\t ]+$/g, ""))
  while (trimmedLines.length > 0 && trimmedLines[trimmedLines.length - 1] === "") trimmedLines.pop()
  if (trimmedLines.length === 1 && trimmedLines[0] === "") return []
  return trimmedLines
}

function countNonOverlappingOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0
  let count = 0
  let idx = 0
  while (true) {
    const next = haystack.indexOf(needle, idx)
    if (next === -1) break
    count++
    idx = next + needle.length
  }
  return count
}

function getSectionBounds(lines: string[], sectionId: OpenMathArtifactsSectionId):
  | { start: number; end: number; contentStart: number }
  | { error: ApplyErr } {
  const startRe = new RegExp(`^<!--\\s*OMO:SECTION\\s+${sectionId}\\s*-->$`)
  const endRe = /^<!--\s*OMO:ENDSECTION\s*-->$/

  const startIndexes: number[] = []
  for (let i = 0; i < lines.length; i++) {
    if (startRe.test(lines[i])) startIndexes.push(i)
  }
  if (startIndexes.length === 0) {
    return { error: { ok: false, error_code: "UNKNOWN_SECTION", details: { section_id: sectionId } } }
  }
  if (startIndexes.length > 1) {
    return {
      error: {
        ok: false,
        error_code: "DUPLICATE_SECTION_MARKER",
        details: { section_id: sectionId, start_markers: startIndexes.length },
      },
    }
  }

  const start = startIndexes[0]
  for (let i = start + 1; i < lines.length; i++) {
    if (endRe.test(lines[i])) {
      return { start, end: i, contentStart: start + 1 }
    }
  }
  return { error: { ok: false, error_code: "UNCLOSED_SECTION", details: { section_id: sectionId } } }
}

function applyReplaceSection(lines: string[], sectionId: OpenMathArtifactsSectionId, newContent: string): string[] | ApplyErr {
  const bounds = getSectionBounds(lines, sectionId)
  if ("error" in bounds) return bounds.error

  const contentLines = normalizeBlockContent(newContent)
  return [
    ...lines.slice(0, bounds.contentStart),
    ...contentLines,
    ...lines.slice(bounds.end),
  ]
}

function applyReplaceUniqueSubstring(
  lines: string[],
  args: { sectionId: OpenMathArtifactsSectionId; old: string; next: string },
): string[] | ApplyErr {
  if (args.old.length < 20) {
    return { ok: false, error_code: "UNIQUE_SUBSTRING_TOO_SHORT", details: { min_length: 20 } }
  }

  const bounds = getSectionBounds(lines, args.sectionId)
  if ("error" in bounds) return bounds.error

  const contentLines = lines.slice(bounds.contentStart, bounds.end)
  const content = contentLines.join("\n")
  const count = countNonOverlappingOccurrences(content, args.old)
  if (count === 0) {
    return {
      ok: false,
      error_code: "UNIQUE_SUBSTRING_NOT_FOUND",
      details: { section_id: args.sectionId },
    }
  }
  if (count !== 1) {
    return {
      ok: false,
      error_code: "UNIQUE_SUBSTRING_NOT_UNIQUE",
      details: { section_id: args.sectionId, matches: count },
    }
  }

  const updatedContent = content.replace(args.old, args.next)
  const updatedLines = updatedContent === "" ? [] : updatedContent.split("\n")
  return [
    ...lines.slice(0, bounds.contentStart),
    ...updatedLines,
    ...lines.slice(bounds.end),
  ]
}

function applyOp(
  currentLines: string[],
  op: OpenMathArtifactsPatchOp,
  opts: Required<Pick<ApplyOpts, "allow_unique_substring_replace">>,
): string[] | ApplyErr {
  if (op.op === "replace_section") {
    return applyReplaceSection(currentLines, op.section_id, op.new_content)
  }
  if (op.op === "replace_unique_substring") {
    if (!opts.allow_unique_substring_replace) {
      return { ok: false, error_code: "UNIQUE_SUBSTRING_DISABLED" }
    }
    return applyReplaceUniqueSubstring(currentLines, {
      sectionId: op.section_id,
      old: op.old,
      next: op.new,
    })
  }

  return { ok: false, error_code: "PATCH_PARSE_ERROR" }
}

export function applyOpenMathArtifactsPatch(args: {
  base_markdown: string
  patch_set: OpenMathArtifactsPatchSet
  opts?: ApplyOpts
}): ApplyOpenMathArtifactsPatchResult {
  const parsedPatch = OpenMathArtifactsPatchSetSchema.safeParse(args.patch_set)
  if (!parsedPatch.success) {
    return {
      ok: false,
      error_code: "PATCH_PARSE_ERROR",
      details: parsedPatch.error.flatten(),
    }
  }

  const maxOps = args.opts?.max_ops ?? 20
  if (parsedPatch.data.ops.length > maxOps) {
    return {
      ok: false,
      error_code: "TOO_MANY_OPS",
      details: { max_ops: maxOps, ops: parsedPatch.data.ops.length },
    }
  }

  const normalizedBase = normalizeMarkdown(args.base_markdown)
  const computedBaseHash = hashOpenMathArtifactsMarkdown(normalizedBase)
  if (computedBaseHash !== parsedPatch.data.base_hash) {
    return {
      ok: false,
      error_code: "BASE_HASH_MISMATCH",
      details: {
        patch_base_hash: parsedPatch.data.base_hash,
        computed_base_hash: computedBaseHash,
      },
    }
  }

  let lines = normalizedBase.split("\n")
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop()

  const allowUniqueSubstring = args.opts?.allow_unique_substring_replace ?? true
  for (const op of parsedPatch.data.ops) {
    const next = applyOp(lines, op, { allow_unique_substring_replace: allowUniqueSubstring })
    if (!Array.isArray(next)) return next
    lines = next
  }

  const applied = `${lines.join("\n")}\n`
  const normalizedApplied = normalizeMarkdown(applied)
  const hash = hashOpenMathArtifactsMarkdown(normalizedApplied)

  const parsed = parseOpenMathArtifactsMarkdown(normalizedApplied)
  if (!parsed.ok) {
    return { ok: false, error_code: "ARTIFACTS_PARSE_ERROR", details: parsed.error }
  }

  const draft = parsed.draft
  const validation = FrozenArtifactsSchema.safeParse({
    reference_solution: draft.reference_solution,
    hint_ladder: draft.hint_ladder,
    grading_rubric: draft.grading_rubric,
    variant_problem: draft.variant_problem,
    review_certificate: PLACEHOLDER_CERTIFICATE,
  })
  if (!validation.success) {
    return {
      ok: false,
      error_code: "DRAFT_VALIDATION_ERROR",
      details: validation.error.flatten(),
    }
  }

  return { ok: true, markdown: normalizedApplied, hash, draft }
}
