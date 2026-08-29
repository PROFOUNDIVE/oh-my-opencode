import { z } from "zod"

import { CampaignHashSchema, NonBlankSchema } from "./literals"

export const OpaqueAttachmentReferenceSchema = z.object({
  attachment_id: z.string().regex(/^attachment-[a-z0-9]+(?:[._-][a-z0-9]+)*$/).max(139),
  kind: NonBlankSchema,
  schema_version: z.number().int().positive(),
  content_sha256: CampaignHashSchema,
  storage_ref: NonBlankSchema,
}).strict().readonly()

export const OpaqueAttachmentReferencesSchema = z.array(OpaqueAttachmentReferenceSchema)
  .default([])
  .superRefine((attachments, context) => {
    const ids = new Set<string>()
    for (const [index, attachment] of attachments.entries()) {
      if (ids.has(attachment.attachment_id)) {
        context.addIssue({
          code: "custom",
          path: [index, "attachment_id"],
          message: "Attachment IDs must be unique",
        })
      }
      ids.add(attachment.attachment_id)
    }
  })
  .readonly()

export type OpaqueAttachmentReference = z.infer<typeof OpaqueAttachmentReferenceSchema>
