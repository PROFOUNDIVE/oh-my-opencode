import { z } from "zod"

export const CertificationWitnessModelOutputSchema = z.object({
  outcome: z.enum(["CONFIRMED", "REJECTED", "INCONCLUSIVE"]),
}).strict().readonly()

export type CertificationWitnessModelOutput = z.infer<typeof CertificationWitnessModelOutputSchema>
