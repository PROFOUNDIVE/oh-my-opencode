import { z } from "zod"

import { sha256 } from "../../workflow/stage-runner/sha256"
import { CampaignHashSchema, CandidateIdSchema, NonBlankSchema } from "./literals"

export const TournamentActionSchema = z.object({
  candidate_id: CandidateIdSchema,
  action: z.enum(["KEEP", "DROP", "MERGE_IDEA"]),
}).strict().readonly()

const TournamentActionsSchema = z.array(TournamentActionSchema)
  .min(1)
  .superRefine((actions, context) => {
    if (new Set(actions.map((action) => action.candidate_id)).size !== actions.length) {
      context.addIssue({ code: "custom", message: "Tournament candidate actions must be unique" })
    }
  })
  .readonly()

export const TournamentResultSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("DECIDED"),
    actions: TournamentActionsSchema,
    synthesis_brief: NonBlankSchema.nullable(),
    synthesis_brief_sha256: CampaignHashSchema.nullable(),
  }).strict(),
  z.object({ kind: z.literal("NEEDS_HUMAN") }).strict(),
]).superRefine((result, context) => {
  switch (result.kind) {
    case "NEEDS_HUMAN":
      return
    case "DECIDED": {
      const keepCount = result.actions.filter((action) => action.action === "KEEP").length
      const mergeCount = result.actions.filter((action) => action.action === "MERGE_IDEA").length
      const isKeep = keepCount === 1 && mergeCount === 0
      const isMerge = keepCount === 0 && mergeCount >= 2
      if (!isKeep && !isMerge) {
        context.addIssue({ code: "custom", path: ["actions"], message: "Tournament requires exactly one KEEP or at least two MERGE_IDEA parents" })
      }
      const hasBrief = result.synthesis_brief !== null
      const hasBriefHash = result.synthesis_brief_sha256 !== null
      if (hasBrief !== hasBriefHash || hasBrief !== isMerge) {
        context.addIssue({ code: "custom", path: ["synthesis_brief"], message: "Only a merge directive requires a hash-bound synthesis brief" })
      }
      if (result.synthesis_brief !== null && result.synthesis_brief_sha256 !== null
        && sha256(result.synthesis_brief) !== result.synthesis_brief_sha256) {
        context.addIssue({ code: "custom", path: ["synthesis_brief_sha256"], message: "Synthesis brief hash must match the exact brief" })
      }
      return
    }
    default:
      assertNever(result)
  }
}).readonly()

function assertNever(value: never): never {
  throw new TypeError(`Unexpected tournament result: ${String(value)}`)
}

export type TournamentResult = z.infer<typeof TournamentResultSchema>
