import { z } from "zod"

import { sha256 } from "../../../workflow/stage-runner/sha256"
import { normalizeCertificationText } from "./canonical-text"
import { CertificationAmendmentIdSchema, CertificationRevisionSchema, NonBlankSchema } from "./literals"

export const CertificationAmendmentScopeSchema = z.union([
  z.enum(["graph", "coverage"]),
  z.string().regex(/^counterexample:obligation-[0-9]{4}$/),
  z.string().regex(/^witness:attack-[0-9]{4}$/),
])

export const CertificationAmendmentEventSchema = z.discriminatedUnion("event_type", [
  z.object({
    event_type: z.literal("ADDED"),
    amendment_id: CertificationAmendmentIdSchema,
    kind: z.enum(["question", "required_check", "suspected_blocker", "scope_change"]),
    scope: CertificationAmendmentScopeSchema,
    content: NonBlankSchema.refine((value) => value === normalizeCertificationText(value)),
    lifecycle: z.literal("ACTIVE"),
    certification_revision: CertificationRevisionSchema,
  }).strict(),
  z.object({
    event_type: z.literal("CONSUMED"),
    amendment_id: CertificationAmendmentIdSchema,
    lifecycle: z.literal("ACTIVE"),
    certification_revision: CertificationRevisionSchema,
  }).strict(),
  z.object({
    event_type: z.literal("RETRACTED"),
    amendment_id: CertificationAmendmentIdSchema,
    lifecycle: z.literal("RETRACTED"),
    certification_revision: CertificationRevisionSchema,
  }).strict(),
]).readonly()

type AmendmentSequence = Readonly<{ readonly last_revision: number; readonly terminal: boolean }>

export const CertificationAmendmentHistorySchema = z.array(CertificationAmendmentEventSchema).superRefine((events, context) => {
  const sequences = new Map<string, AmendmentSequence>()
  let lastRevision = -1
  for (const [index, event] of events.entries()) {
    if (event.certification_revision < lastRevision) addIssue(context, index, "Amendment revisions must be append ordered")
    lastRevision = event.certification_revision
    const current = sequences.get(event.amendment_id)
    switch (event.event_type) {
      case "ADDED":
        if (event.amendment_id !== `cert-amendment-${event.certification_revision}`) addIssue(context, index, "Amendment ID must match its added revision")
        if (current !== undefined) addIssue(context, index, "Amendment IDs may be added only once")
        else sequences.set(event.amendment_id, { last_revision: event.certification_revision, terminal: false })
        break
      case "CONSUMED":
      case "RETRACTED":
        if (current === undefined || current.terminal || event.certification_revision <= current.last_revision) addIssue(context, index, "Invalid amendment lifecycle")
        else sequences.set(event.amendment_id, { last_revision: event.certification_revision, terminal: true })
        break
      default:
        assertNever(event)
    }
  }
}).readonly()

export function hashCertificationAmendment(event: z.infer<typeof CertificationAmendmentEventSchema>): string {
  return sha256(JSON.stringify(event))
}

function addIssue(context: z.RefinementCtx, index: number, message: string): void {
  context.addIssue({ code: "custom", path: [index], message })
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected certification amendment event: ${String(value)}`)
}

export type CertificationAmendmentEvent = z.infer<typeof CertificationAmendmentEventSchema>
