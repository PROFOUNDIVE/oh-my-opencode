import { visit } from "jsonc-parser"
import { z } from "zod"

import { parseJsonOutput } from "../../workflow/adapters/json-output-parser"
import { sha256 } from "../../workflow/stage-runner/sha256"
import { CampaignHashSchema, NonBlankSchema, TournamentResultSchema } from "../state"
import { TournamentLabelSchema, type TournamentLabelMapping } from "./tournament-input"

export type { TournamentLabelMapping } from "./tournament-input"

const TournamentModelActionSchema = z.object({
  label: TournamentLabelSchema,
  action: z.enum(["KEEP", "DROP", "MERGE_IDEA"]),
}).strict().readonly()

const TournamentModelOutputSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("DECIDED"),
    actions: z.array(TournamentModelActionSchema).min(1).readonly(),
    synthesis_brief: NonBlankSchema.nullable(),
  }).strict().readonly(),
  z.object({ kind: z.literal("NEEDS_HUMAN") }).strict().readonly(),
]).readonly()

type TournamentResult = z.infer<typeof TournamentResultSchema>
export type TournamentOutputAdapterResult =
  | Readonly<{ readonly ok: true; readonly result: TournamentResult }>
  | Readonly<{
      readonly ok: false
      readonly error: Readonly<{
        readonly code: "INVALID_JSON" | "DUPLICATE_FIELD" | "INVALID_TOURNAMENT_OUTPUT"
        readonly message: string
      }>
    }>

export function adaptTournamentOutput(
  rawOutput: string,
  mapping: TournamentLabelMapping,
): TournamentOutputAdapterResult {
  const parsed = parseJsonOutput(rawOutput)
  if (!parsed.ok) return failure("INVALID_JSON", "Tournament output must be one valid JSON object")
  if (hasDuplicateField(rawOutput)) return failure("DUPLICATE_FIELD", "Tournament output contains a duplicate field")
  const modelOutput = TournamentModelOutputSchema.safeParse(parsed.value)
  if (!modelOutput.success) return failure("INVALID_TOURNAMENT_OUTPUT", "Tournament output has an unsupported shape")
  if (modelOutput.data.kind === "NEEDS_HUMAN") return { ok: true, result: modelOutput.data }
  const labels = new Map(mapping.map((entry) => [entry.label, entry.candidate_id]))
  const actionLabels = modelOutput.data.actions.map((action) => action.label)
  if (labels.size !== mapping.length || new Set(actionLabels).size !== actionLabels.length
    || actionLabels.length !== labels.size || actionLabels.some((label) => !labels.has(label))) {
    return failure("INVALID_TOURNAMENT_OUTPUT", "Tournament actions must cover each admitted label exactly once")
  }
  const keepCount = modelOutput.data.actions.filter((action) => action.action === "KEEP").length
  const mergeCount = modelOutput.data.actions.filter((action) => action.action === "MERGE_IDEA").length
  const isKeep = keepCount === 1 && mergeCount === 0 && modelOutput.data.synthesis_brief === null
  const isMerge = keepCount === 0 && mergeCount >= 2 && modelOutput.data.synthesis_brief !== null
  if (!isKeep && !isMerge) {
    return failure("INVALID_TOURNAMENT_OUTPUT", "Tournament requires one KEEP or one merge directive with at least two parents")
  }
  const brief = modelOutput.data.synthesis_brief
  const result = TournamentResultSchema.safeParse({
    kind: "DECIDED",
    actions: modelOutput.data.actions.map((action) => ({
      candidate_id: labels.get(action.label),
      action: action.action,
    })),
    synthesis_brief: brief,
    synthesis_brief_sha256: brief === null ? null : CampaignHashSchema.parse(sha256(brief)),
  })
  return result.success
    ? { ok: true, result: result.data }
    : failure("INVALID_TOURNAMENT_OUTPUT", "Tournament decision violates categorical invariants")
}

function hasDuplicateField(rawOutput: string): boolean {
  const fieldsByObject = new Map<string, Set<string>>()
  let duplicate = false
  visit(rawOutput, {
    onObjectProperty: (property, _offset, _length, _line, _character, pathSupplier) => {
      const objectPath = JSON.stringify(pathSupplier())
      const fields = fieldsByObject.get(objectPath) ?? new Set<string>()
      if (fields.has(property)) duplicate = true
      fields.add(property)
      fieldsByObject.set(objectPath, fields)
    },
  }, { disallowComments: true, allowTrailingComma: false, allowEmptyContent: false })
  return duplicate
}

function failure(
  code: Extract<TournamentOutputAdapterResult, { readonly ok: false }>["error"]["code"],
  message: string,
): Extract<TournamentOutputAdapterResult, { readonly ok: false }> {
  return { ok: false, error: { code, message } }
}
