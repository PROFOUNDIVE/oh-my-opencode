import { z } from "zod"

import { sha256 } from "../../../workflow/stage-runner/sha256"
import { CertificationRevisionSchema, CertificationSha256Schema } from "./literals"

export const CertificationFinalizationSchema = z.object({
  completed_at_revision: CertificationRevisionSchema,
  graph_sha256: CertificationSha256Schema,
  summary_sha256: CertificationSha256Schema,
}).strict().readonly()

export function hashCertificationFinalization(finalization: z.infer<typeof CertificationFinalizationSchema>): string {
  return sha256(JSON.stringify(finalization))
}

export type CertificationFinalization = z.infer<typeof CertificationFinalizationSchema>
