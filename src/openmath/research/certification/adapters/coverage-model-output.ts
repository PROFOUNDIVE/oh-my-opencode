import { z } from "zod"

import { CoverageFindingSchema, CoverageVerdictSchema } from "../state/coverage"

export const CoverageModelOutputSchema = z.object({
  verdict: CoverageVerdictSchema,
  findings: z.array(CoverageFindingSchema).max(256).readonly(),
}).strict().readonly()

export type CoverageModelOutput = z.infer<typeof CoverageModelOutputSchema>
