import type { z } from "zod"

import type { AggregateInvariantInput } from "./aggregate-invariant-input"
import type { OpaqueAttachmentReference } from "./attachments"

export function validateAttachmentIdentityInvariants(state: AggregateInvariantInput, context: z.RefinementCtx): void {
  const attachments = [
    ...state.attachments,
    ...state.candidates.flatMap((candidate) => candidate.attachments),
    ...state.screen_receipts.flatMap((screen) => screen.attachments),
    ...(state.dossier?.attachments ?? []),
  ]
  const byId = new Map<string, OpaqueAttachmentReference>()
  for (const attachment of attachments) {
    const existing = byId.get(attachment.attachment_id)
    if (existing !== undefined && !sameAttachment(existing, attachment)) {
      context.addIssue({ code: "custom", path: ["attachments"], message: "Repeated attachment IDs must preserve all five opaque fields" })
    }
    byId.set(attachment.attachment_id, attachment)
  }
}

function sameAttachment(left: OpaqueAttachmentReference, right: OpaqueAttachmentReference): boolean {
  return left.attachment_id === right.attachment_id
    && left.kind === right.kind
    && left.schema_version === right.schema_version
    && left.content_sha256 === right.content_sha256
    && left.storage_ref === right.storage_ref
}
