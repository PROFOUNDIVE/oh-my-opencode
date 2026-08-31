import { z } from "zod"

const ReportedCaseCountSchema = z.number().int().nonnegative().nullable()

export const CertificationAttackModelOutputSchema = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("COUNTEREXAMPLE_FOUND"),
    witness: z.string().min(1).max(20_000),
    reported_case_count: ReportedCaseCountSchema,
  }).strict(),
  ...(["NO_COUNTEREXAMPLE_FOUND", "INVALID_TARGET", "INCONCLUSIVE"] as const).map((outcome) => z.object({
    outcome: z.literal(outcome),
    witness: z.null(),
    reported_case_count: ReportedCaseCountSchema,
  }).strict()),
]).readonly()

export type CertificationAttackModelOutput = z.infer<typeof CertificationAttackModelOutputSchema>
