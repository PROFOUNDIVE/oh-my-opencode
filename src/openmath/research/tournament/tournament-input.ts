import { z } from "zod"

import type { CandidateId, ScreenNormalizedOutput } from "../state"
import { ScreenNormalizedOutputSchema } from "../state"

export const TournamentLabelSchema = z.string().regex(/^entry-[0-9]{3}$/).brand("TournamentAnonymousLabel")
export type TournamentLabel = z.infer<typeof TournamentLabelSchema>

const TournamentCandidateInputSchema = z.object({
  label: TournamentLabelSchema,
  artifact: z.object({ content: z.string() }).strict().readonly(),
  screen_summaries: z.array(ScreenNormalizedOutputSchema).min(1).readonly(),
}).strict().readonly()

export const TournamentInputSchema = z.object({
  candidates: z.array(TournamentCandidateInputSchema).min(1).readonly(),
}).strict().readonly()

export type TournamentInput = z.infer<typeof TournamentInputSchema>
export type TournamentLabelMapping = readonly Readonly<{
  readonly label: TournamentLabel
  readonly candidate_id: CandidateId
}>[]

export type TournamentCandidateContent = Readonly<{
  readonly candidate_id: CandidateId
  readonly artifact_content: string
  readonly screen_summaries: readonly ScreenNormalizedOutput[]
}>

export function buildTournamentSession(candidates: readonly TournamentCandidateContent[]): Readonly<{
  readonly payload: TournamentInput
  readonly label_mapping: TournamentLabelMapping
}> {
  const labelMapping = candidates.map((candidate, index) => ({
    label: TournamentLabelSchema.parse(`entry-${String(index + 1).padStart(3, "0")}`),
    candidate_id: candidate.candidate_id,
  }))
  return {
    label_mapping: labelMapping,
    payload: TournamentInputSchema.parse({
      candidates: candidates.map((candidate, index) => ({
        label: labelMapping[index]?.label,
        artifact: { content: candidate.artifact_content },
        screen_summaries: candidate.screen_summaries,
      })),
    }),
  }
}
