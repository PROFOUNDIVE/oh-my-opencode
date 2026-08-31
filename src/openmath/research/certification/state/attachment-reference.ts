import { z } from "zod"

import { sha256 } from "../../../workflow/stage-runner/sha256"
import { OpaqueAttachmentReferenceSchema, type OpaqueAttachmentReference } from "../../state/attachments"
import {
  CertificationGenerationIdSchema,
  CertificationRevisionSchema,
  CertificationSha256Schema,
} from "./literals"

const CertificationAttachmentInputSchema = z.object({
  generation_id: CertificationGenerationIdSchema,
  certification_revision: CertificationRevisionSchema,
  content_sha256: CertificationSha256Schema,
}).strict().readonly()

export function buildCertificationAttachmentReference(
  input: z.input<typeof CertificationAttachmentInputSchema>,
): OpaqueAttachmentReference {
  const parsed = CertificationAttachmentInputSchema.parse(input)
  const revision = String(parsed.certification_revision).padStart(12, "0")
  const attachmentHash = sha256(`${parsed.generation_id}\n${revision}\n${parsed.content_sha256}`)
  return OpaqueAttachmentReferenceSchema.parse({
    attachment_id: `attachment-certification-${attachmentHash}`,
    kind: "research-certification",
    schema_version: 1,
    content_sha256: parsed.content_sha256,
    storage_ref: `certification/${parsed.generation_id}/certification.rev-${revision}.json`,
  })
}
