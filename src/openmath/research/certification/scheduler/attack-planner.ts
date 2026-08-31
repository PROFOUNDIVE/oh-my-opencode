import { z } from "zod"

import {
  AttackBoundsSchema,
  CertificationAttackModeSchema,
  AttackAttemptSchema,
  type AttackAttempt,
} from "../state/attacks"
import { CoverageReviewSchema } from "../state/coverage"
import { CertificationGraphSchema } from "../state/graph"
import { certificationPrerequisiteClosureIds } from "../state/graph-invariants"
import { CertificationJobTargetSchema } from "../state/jobs"
import {
  AttackAttemptIdSchema,
  CertificationSha256Schema,
  ObligationIdSchema,
} from "../state/literals"
import { attackTargetMatchesPlan, terminalAttackMatchesPlan } from "./attack-target-identity"

export const CertificationAttackPlannerProfileSchema = z.object({
  allowed_attack_modes: z.array(CertificationAttackModeSchema).min(1).max(7).superRefine((modes, context) => {
    if (new Set(modes).size !== modes.length) context.addIssue({ code: "custom", message: "Attack modes must be unique" })
  }).readonly(),
  max_attacks_per_obligation: z.number().int().min(1).max(7),
  max_active_certification_jobs: z.number().int().min(1).max(16),
}).strict().superRefine((profile, context) => {
  if (profile.max_attacks_per_obligation > profile.allowed_attack_modes.length) {
    context.addIssue({ code: "custom", path: ["max_attacks_per_obligation"], message: "Attack cap exceeds configured modes" })
  }
}).readonly()

export const CertificationAttackPlanEntrySchema = z.object({
  attack_attempt_id: AttackAttemptIdSchema,
  obligation_id: ObligationIdSchema,
  node_sha256: CertificationSha256Schema,
  graph_sha256: CertificationSha256Schema,
  artifact_sha256: CertificationSha256Schema,
  mode: CertificationAttackModeSchema,
  ordinal: z.number().int().positive(),
  bounds: AttackBoundsSchema,
}).strict().readonly()

export type CertificationAttackPlanEntry = z.infer<typeof CertificationAttackPlanEntrySchema>

export type BoundedCertificationAttackPlanResult =
  | Readonly<{
      readonly ok: true
      readonly plan: readonly CertificationAttackPlanEntry[]
      readonly ready: readonly CertificationAttackPlanEntry[]
      readonly terminal_attempts: readonly AttackAttempt[]
    }>
  | Readonly<{
      readonly ok: false
      readonly error_code: "INVALID_PROFILE" | "STALE_TARGET" | "DUPLICATE_ATTEMPT" | "CONCURRENCY_LIMIT_EXCEEDED"
      readonly message: string
    }>

export function planBoundedCertificationAttacks(input: Readonly<{
  readonly graph: unknown
  readonly coverage: unknown
  readonly profile: unknown
  readonly active_targets: readonly unknown[]
  readonly terminal_attempts: readonly unknown[]
}>): BoundedCertificationAttackPlanResult {
  const profile = CertificationAttackPlannerProfileSchema.safeParse(input.profile)
  if (!profile.success) return failure("INVALID_PROFILE", "Attack profile modes or bounds are invalid")
  const graph = CertificationGraphSchema.safeParse(input.graph)
  const coverage = CoverageReviewSchema.safeParse(input.coverage)
  if (!graph.success || !coverage.success || coverage.data.verdict !== "PASS"
    || coverage.data.graph_sha256 !== graph.data.graph_sha256
    || coverage.data.artifact_sha256 !== graph.data.artifact.artifact_sha256) {
    return failure("STALE_TARGET", "Attack planning requires the exact covered graph and artifact")
  }
  const active = z.array(CertificationJobTargetSchema).safeParse(input.active_targets)
  const terminal = z.array(AttackAttemptSchema).safeParse(input.terminal_attempts)
  if (!active.success || !terminal.success) return failure("STALE_TARGET", "Attack progress contains an invalid target")
  const activeAttacks = active.data.flatMap((target) => target.kind === "ATTACK" ? [target] : [])
  if (activeAttacks.length !== active.data.length) return failure("STALE_TARGET", "Active attack progress contains another job kind")
  if (activeAttacks.length > profile.data.max_active_certification_jobs) {
    return failure("CONCURRENCY_LIMIT_EXCEEDED", "Active attack jobs exceed the configured concurrency cap")
  }
  const plan = buildCertificationAttackPlan({ graph: graph.data, coverage: coverage.data, profile: profile.data })
  const byId = new Map(plan.map((attempt) => [attempt.attack_attempt_id, attempt]))
  const activeIds = activeAttacks.map((target) => target.attack_attempt_id)
  const terminalIds = terminal.data.map((attempt) => attempt.attack_attempt_id)
  if (new Set(activeIds).size !== activeIds.length || new Set(terminalIds).size !== terminalIds.length
    || activeIds.some((id) => terminalIds.includes(id))) {
    return failure("DUPLICATE_ATTEMPT", "Attack progress repeats an attempt identity")
  }
  if (activeAttacks.some((target) => {
    const expected = byId.get(target.attack_attempt_id)
    return expected === undefined || !attackTargetMatchesPlan(target, expected)
  }) || terminal.data.some((attempt) => {
    const expected = byId.get(attempt.attack_attempt_id)
    return expected === undefined || !terminalAttackMatchesPlan(attempt, expected)
  })) return failure("STALE_TARGET", "Attack progress does not match the canonical plan")
  const completeIds = new Set(terminalIds)
  const busyIds = new Set(activeIds)
  const ready = plan.filter((attempt) => !completeIds.has(attempt.attack_attempt_id) && !busyIds.has(attempt.attack_attempt_id))
    .slice(0, profile.data.max_active_certification_jobs - activeAttacks.length)
  const orderedTerminal = [...terminal.data].sort((left, right) => left.ordinal - right.ordinal)
  return { ok: true, plan, ready, terminal_attempts: orderedTerminal }
}

export function buildCertificationAttackPlan(input: Readonly<{
  readonly graph: z.infer<typeof CertificationGraphSchema>
  readonly coverage: z.infer<typeof CoverageReviewSchema>
  readonly profile: z.infer<typeof CertificationAttackPlannerProfileSchema>
}>): readonly CertificationAttackPlanEntry[] {
  const closure = certificationPrerequisiteClosureIds(input.graph, input.graph.required_root_ids)
  const modes = input.profile.allowed_attack_modes.slice(0, input.profile.max_attacks_per_obligation)
  let ordinal = 0
  return input.graph.nodes.filter((node) => closure.has(node.obligation_id)).flatMap((node) => modes.map((mode, modeIndex) => {
    ordinal += 1
    return CertificationAttackPlanEntrySchema.parse({
      attack_attempt_id: `attack-${String(ordinal).padStart(4, "0")}`,
      obligation_id: node.obligation_id,
      node_sha256: node.node_sha256,
      graph_sha256: input.graph.graph_sha256,
      artifact_sha256: input.graph.artifact.artifact_sha256,
      mode,
      ordinal,
      bounds: {
        coverage_round: input.coverage.coverage_round,
        mode_ordinal: modeIndex + 1,
        max_attacks_per_obligation: input.profile.max_attacks_per_obligation,
        max_active_certification_jobs: input.profile.max_active_certification_jobs,
      },
    })
  }))
}

function failure(
  errorCode: Extract<BoundedCertificationAttackPlanResult, { readonly ok: false }>["error_code"],
  message: string,
): Extract<BoundedCertificationAttackPlanResult, { readonly ok: false }> {
  return { ok: false, error_code: errorCode, message }
}
