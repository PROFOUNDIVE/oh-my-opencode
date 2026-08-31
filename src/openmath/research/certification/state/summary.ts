import { z } from "zod"

import { sha256 } from "../../../workflow/stage-runner/sha256"
import {
  CertificationGenerationIdSchema,
  CertificationIdSchema,
  CertificationRevisionSchema,
  CertificationSha256Schema,
} from "./literals"

const AttackOutcomeCountsSchema = z.object({
  counterexample_found: z.number().int().nonnegative(),
  no_counterexample_found: z.number().int().nonnegative(),
  invalid_target: z.number().int().nonnegative(),
  inconclusive: z.number().int().nonnegative(),
}).strict().readonly()

const WitnessOutcomeCountsSchema = z.object({
  confirmed: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative(),
  inconclusive: z.number().int().nonnegative(),
}).strict().readonly()

export const CertificationSummaryV1Schema = z.object({
  schema_version: z.literal(1),
  certification_id: CertificationIdSchema,
  generation_id: CertificationGenerationIdSchema,
  certification_revision: CertificationRevisionSchema,
  artifact_sha256: CertificationSha256Schema,
  graph_sha256: CertificationSha256Schema,
  coverage_verdict: z.literal("PASS"),
  total_obligation_count: z.number().int().nonnegative(),
  required_obligation_count: z.number().int().nonnegative(),
  attack_outcomes: AttackOutcomeCountsSchema,
  witness_outcomes: WitnessOutcomeCountsSchema,
  uncertainty_count: z.number().int().nonnegative(),
  approval_eligible: z.boolean(),
}).strict().readonly()

export function hashCertificationSummary(summary: z.infer<typeof CertificationSummaryV1Schema>): string {
  return sha256(JSON.stringify(summary))
}

export type CertificationSummaryV1 = z.infer<typeof CertificationSummaryV1Schema>
