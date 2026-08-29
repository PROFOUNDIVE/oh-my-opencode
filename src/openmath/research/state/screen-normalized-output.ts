import { z } from "zod"

import { NonBlankSchema } from "./literals"

export const ScreenVerdictSchema = z.enum([
  "VIABLE",
  "REPAIRABLE",
  "FATAL_FLAW",
  "INCONCLUSIVE",
])

const NormalizedTextListSchema = z.array(NonBlankSchema).readonly()

export const ScreenNormalizedOutputShape = {
  verdict: ScreenVerdictSchema,
  blocking_issues: NormalizedTextListSchema,
  unresolved_obligations: NormalizedTextListSchema,
  assumptions: NormalizedTextListSchema,
  novel_elements: NormalizedTextListSchema,
} as const

export const ScreenNormalizedOutputSchema = z.object(ScreenNormalizedOutputShape).strict().readonly()

export type ScreenNormalizedOutput = z.infer<typeof ScreenNormalizedOutputSchema>
export type ScreenVerdict = z.infer<typeof ScreenVerdictSchema>
