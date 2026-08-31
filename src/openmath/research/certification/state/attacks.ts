import { z } from "zod"

import { sha256 } from "../../../workflow/stage-runner/sha256"
import {
  AttackAttemptIdSchema,
  CertificationJobIdSchema,
  CertificationRevisionSchema,
  CertificationSha256Schema,
  NonBlankSchema,
  ObligationIdSchema,
} from "./literals"

export const CertificationAttackModeSchema = z.enum([
  "EDGE_CASE",
  "FINITE_SEARCH",
  "DEGENERATE_CASE",
  "ASSUMPTION_REMOVAL",
  "PARAMETER_BOUNDARY",
  "CONSTRUCTION_SEARCH",
  "COMPUTATIONAL_FALSIFICATION",
])

export const AttackBoundsSchema = z.object({
  coverage_round: z.number().int().positive().max(5),
  mode_ordinal: z.number().int().positive().max(7),
  max_attacks_per_obligation: z.number().int().positive().max(7),
  max_active_certification_jobs: z.number().int().positive().max(16),
}).strict().readonly()

const AttackBaseSchema = z.object({
  attack_attempt_id: AttackAttemptIdSchema,
  certification_revision: CertificationRevisionSchema,
  job_id: CertificationJobIdSchema,
  obligation_id: ObligationIdSchema,
  node_sha256: CertificationSha256Schema,
  graph_sha256: CertificationSha256Schema,
  artifact_sha256: CertificationSha256Schema,
  mode: CertificationAttackModeSchema,
  ordinal: z.number().int().positive(),
  bounds: AttackBoundsSchema,
})

export const AttackAttemptSchema = z.discriminatedUnion("outcome", [
  AttackBaseSchema.extend({
    outcome: z.literal("COUNTEREXAMPLE_FOUND"),
    witness: NonBlankSchema,
    witness_sha256: CertificationSha256Schema,
  }).strict(),
  ...(["NO_COUNTEREXAMPLE_FOUND", "INVALID_TARGET", "INCONCLUSIVE"] as const).map((outcome) => AttackBaseSchema.extend({
    outcome: z.literal(outcome),
    witness: z.null(),
    witness_sha256: z.null(),
  }).strict()),
]).superRefine((attempt, context) => {
  const expectedId = `attack-${String(attempt.ordinal).padStart(4, "0")}`
  if (attempt.attack_attempt_id !== expectedId) context.addIssue({ code: "custom", path: ["attack_attempt_id"], message: "Attack ID must match canonical ordinal" })
  if (attempt.bounds.mode_ordinal > attempt.bounds.max_attacks_per_obligation) context.addIssue({ code: "custom", path: ["bounds", "mode_ordinal"], message: "Mode ordinal exceeds attack cap" })
  if (attempt.outcome === "COUNTEREXAMPLE_FOUND" && sha256(attempt.witness) !== attempt.witness_sha256) context.addIssue({ code: "custom", path: ["witness_sha256"], message: "Witness hash must bind exact witness text" })
}).readonly()

export function hashAttackAttempt(attempt: z.infer<typeof AttackAttemptSchema>): string {
  return sha256(JSON.stringify(attempt))
}

export type CertificationAttackMode = z.infer<typeof CertificationAttackModeSchema>
export type AttackAttempt = z.infer<typeof AttackAttemptSchema>
