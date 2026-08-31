import { z } from "zod"

import { sha256 } from "../../../workflow/stage-runner/sha256"
import { CertificationSha256Schema } from "./literals"

export const CertificationSourceSpanSchema = z.object({
  start_byte: z.number().int().nonnegative(),
  end_byte: z.number().int().positive(),
  span_sha256: CertificationSha256Schema,
}).strict().superRefine((span, context) => {
  if (span.start_byte >= span.end_byte) {
    context.addIssue({ code: "custom", path: ["end_byte"], message: "Source spans must be nonempty half-open ranges" })
  }
}).readonly()

export function sourceSpanError(content: string, span: z.infer<typeof CertificationSourceSpanSchema>): string | null {
  const bytes = Buffer.from(content, "utf8")
  if (span.end_byte > bytes.length) return "Source span exceeds exact UTF-8 bytes"
  if (!isBoundary(bytes, span.start_byte) || !isBoundary(bytes, span.end_byte)) return "Source span must use UTF-8 byte boundaries"
  const exact = bytes.subarray(span.start_byte, span.end_byte).toString("utf8")
  if (sha256(exact) !== span.span_sha256) return "Source span hash must bind exact UTF-8 bytes"
  return null
}

function isBoundary(bytes: Buffer, offset: number): boolean {
  if (offset === 0 || offset === bytes.length) return true
  const value = bytes[offset]
  return value !== undefined && (value & 0xc0) !== 0x80
}

export type CertificationSourceSpan = z.infer<typeof CertificationSourceSpanSchema>
