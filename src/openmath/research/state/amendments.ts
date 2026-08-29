import { z } from "zod"

import { CampaignRevisionSchema, NonBlankSchema } from "./literals"

const AmendmentIdSchema = z.string().regex(/^amendment-[1-9][0-9]*$/)

export const CampaignAmendmentScopeSchema = z.union([
  z.string().regex(/^candidate:[a-z0-9]+(?:[._-][a-z0-9]+)*$/),
  z.enum([
    "all_candidates",
    "next_screen",
    "all_remaining_screens",
    "next_tournament",
    "selected_refinement",
  ]),
])

export const CampaignAmendmentEventSchema = z.discriminatedUnion("event_type", [
  z.object({
    event_type: z.literal("ADDED"),
    amendment_id: AmendmentIdSchema,
    kind: z.enum(["question", "required_check", "suspected_blocker", "scope_change"]),
    scope: CampaignAmendmentScopeSchema,
    content: NonBlankSchema,
    lifecycle: z.literal("ACTIVE"),
    state_revision: CampaignRevisionSchema,
  }).strict(),
  z.object({
    event_type: z.literal("CONSUMED"),
    amendment_id: AmendmentIdSchema,
    lifecycle: z.literal("ACTIVE"),
    state_revision: CampaignRevisionSchema,
  }).strict(),
  z.object({
    event_type: z.literal("RETRACTED"),
    amendment_id: AmendmentIdSchema,
    lifecycle: z.literal("RETRACTED"),
    state_revision: CampaignRevisionSchema,
  }).strict(),
]).readonly()

type AmendmentSequence = {
  readonly last_revision: number
  readonly consumed: boolean
  readonly retracted: boolean
}

export const CampaignAmendmentHistorySchema = z.array(CampaignAmendmentEventSchema)
  .superRefine((events, context) => {
    const sequences = new Map<string, AmendmentSequence>()
    let lastRevision = -1
    for (const [index, event] of events.entries()) {
      if (event.state_revision < lastRevision) addIssue(context, index, "Amendment revisions must be append ordered")
      lastRevision = event.state_revision
      const current = sequences.get(event.amendment_id)
      switch (event.event_type) {
        case "ADDED":
          if (event.amendment_id !== `amendment-${event.state_revision}`) addIssue(context, index, "Amendment ID must match its added revision")
          if (current !== undefined) addIssue(context, index, "Amendment IDs may be added only once")
          else sequences.set(event.amendment_id, { last_revision: event.state_revision, consumed: false, retracted: false })
          break
        case "CONSUMED":
          if (current === undefined) addIssue(context, index, "Consumed amendment must already exist")
          else if (event.state_revision <= current.last_revision || current.consumed || current.retracted) addIssue(context, index, "Invalid amendment consumption lifecycle")
          else sequences.set(event.amendment_id, { last_revision: event.state_revision, consumed: true, retracted: false })
          break
        case "RETRACTED":
          if (current === undefined) addIssue(context, index, "Retracted amendment must already exist")
          else if (event.state_revision <= current.last_revision || current.consumed || current.retracted) addIssue(context, index, "Invalid amendment retraction lifecycle")
          else sequences.set(event.amendment_id, { ...current, last_revision: event.state_revision, retracted: true })
          break
        default:
          assertNever(event)
      }
    }
  })
  .readonly()

function addIssue(context: z.RefinementCtx, index: number, message: string): void {
  context.addIssue({ code: "custom", path: [index], message })
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected campaign amendment event: ${String(value)}`)
}

export type CampaignAmendmentEvent = z.infer<typeof CampaignAmendmentEventSchema>
