import { z } from "zod"

import { AmendmentEventSchema } from "./contracts"

type AmendmentSequenceState = {
  readonly scope: string
  last_revision: number
  consumed: boolean
  retracted: boolean
}

export const AmendmentHistorySchema = z.array(AmendmentEventSchema).superRefine((events, context) => {
  const amendments = new Map<string, AmendmentSequenceState>()
  let lastRevision = -1

  for (const [index, event] of events.entries()) {
    const previousRevision = lastRevision
    if (event.state_revision < lastRevision) {
      addIssue(context, index, "Amendment event revisions must be append ordered")
    }
    lastRevision = event.state_revision

    const current = amendments.get(event.amendment_id)
    switch (event.event_type) {
      case "ADDED":
        if (event.amendment_id !== `amendment-${event.state_revision}`) {
          addIssue(context, index, "Added amendment ID must match its state revision")
        }
        if (event.state_revision <= previousRevision && index > 0) {
          addIssue(context, index, "Added amendments require a new state revision")
        }
        if (current) addIssue(context, index, "Amendment IDs must be added exactly once")
        else amendments.set(event.amendment_id, {
          scope: event.scope,
          last_revision: event.state_revision,
          consumed: false,
          retracted: false,
        })
        break
      case "CONSUMED":
        if (!current) addIssue(context, index, "Consumed amendment must already exist")
        else if (event.state_revision <= current.last_revision) addIssue(context, index, "Amendment lifecycle revisions must increase")
        else if (current.retracted) addIssue(context, index, "Retracted amendment cannot be consumed")
        else if (current.scope !== "next_review") addIssue(context, index, "Only next_review amendments are consumed")
        else if (current.consumed) addIssue(context, index, "Amendment cannot be consumed twice")
        else {
          current.consumed = true
          current.last_revision = event.state_revision
        }
        break
      case "RETRACTED":
        if (!current) addIssue(context, index, "Retracted amendment must already exist")
        else if (event.state_revision <= current.last_revision) addIssue(context, index, "Amendment lifecycle revisions must increase")
        else if (current.retracted) addIssue(context, index, "Amendment cannot be retracted twice")
        else {
          current.retracted = true
          current.last_revision = event.state_revision
        }
        break
      default:
        assertNever(event)
    }
  }
})

function addIssue(context: z.RefinementCtx, index: number, message: string): void {
  context.addIssue({ code: z.ZodIssueCode.custom, path: [index], message })
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected amendment event: ${String(value)}`)
}
