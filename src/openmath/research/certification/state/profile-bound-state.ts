import { z } from "zod"

import { CertificationAttackModeSchema } from "./attacks"
import { CertificationSha256Schema } from "./literals"
import { ResearchCertificationStateV1Schema } from "./schema"

const CertificationProfileLimitsSchema = z.object({
  certification_profile_sha256: CertificationSha256Schema,
  max_obligations: z.number().int().min(1).max(256),
  max_coverage_rounds: z.number().int().min(1).max(5),
  max_coverage_findings: z.number().int().min(1).max(256),
  allowed_attack_modes: z.array(CertificationAttackModeSchema).min(1).max(7).superRefine((modes, context) => {
    if (new Set(modes).size !== modes.length) context.addIssue({ code: "custom", message: "Attack modes must be unique" })
  }).readonly(),
  max_attacks_per_obligation: z.number().int().min(1).max(7),
  max_active_certification_jobs: z.number().int().min(1).max(16),
}).strict().superRefine((profile, context) => {
  if (profile.max_attacks_per_obligation > profile.allowed_attack_modes.length) context.addIssue({ code: "custom", path: ["max_attacks_per_obligation"], message: "Attack cap cannot exceed configured modes" })
}).readonly()

export const CertificationProfileBoundStateSchema = z.object({
  state: ResearchCertificationStateV1Schema,
  profile: CertificationProfileLimitsSchema,
}).strict().superRefine(({ state, profile }, context) => {
  if (state.certification_profile_sha256 !== profile.certification_profile_sha256) addIssue(context, ["profile", "certification_profile_sha256"], "State must bind exact certification profile")
  for (const [index, graph] of state.graphs.entries()) {
    if (graph.nodes.length > profile.max_obligations) addIssue(context, ["state", "graphs", index, "nodes"], "Graph exceeds profile obligation cap")
  }
  for (const [index, coverage] of state.coverage_reviews.entries()) {
    if (coverage.coverage_round > profile.max_coverage_rounds || coverage.findings.length > profile.max_coverage_findings) addIssue(context, ["state", "coverage_reviews", index], "Coverage exceeds profile round or finding cap")
  }
  if (state.active_job_ids.length > profile.max_active_certification_jobs) addIssue(context, ["state", "active_job_ids"], "Active certification jobs exceed profile concurrency")
  validateAttackPlan(state, profile, context)
}).readonly()

function validateAttackPlan(
  state: z.infer<typeof ResearchCertificationStateV1Schema>,
  profile: z.infer<typeof CertificationProfileLimitsSchema>,
  context: z.RefinementCtx,
): void {
  const graph = state.graphs[state.graphs.length - 1]
  const coverage = state.coverage_reviews[state.coverage_reviews.length - 1]
  if (graph === undefined || coverage === undefined) return
  const modes = profile.allowed_attack_modes.slice(0, profile.max_attacks_per_obligation)
  const expected = graph.nodes.filter((node) => node.required).flatMap((node) => modes.map((mode, modeIndex) => ({
    obligation_id: node.obligation_id,
    node_sha256: node.node_sha256,
    mode,
    mode_ordinal: modeIndex + 1,
  })))
  for (const [index, attack] of state.attack_attempts.entries()) {
    const target = expected[index]
    if (target === undefined || attack.obligation_id !== target.obligation_id || attack.node_sha256 !== target.node_sha256
      || attack.mode !== target.mode || attack.bounds.mode_ordinal !== target.mode_ordinal
      || attack.graph_sha256 !== graph.graph_sha256 || attack.bounds.coverage_round !== coverage.coverage_round
      || attack.bounds.max_attacks_per_obligation !== profile.max_attacks_per_obligation
      || attack.bounds.max_active_certification_jobs !== profile.max_active_certification_jobs) {
      addIssue(context, ["state", "attack_attempts", index], "Attack attempt violates canonical profile plan")
    }
  }
  if (state.status === "COMPLETE" && state.attack_attempts.length !== expected.length) addIssue(context, ["state", "attack_attempts"], "Completion requires every bounded attack target")
}

function addIssue(context: z.RefinementCtx, path: readonly (string | number)[], message: string): void {
  context.addIssue({ code: "custom", path: [...path], message })
}
