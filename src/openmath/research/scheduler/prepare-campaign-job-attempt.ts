import type { CampaignJobAttempt, ResearchCampaignStateV1 } from "../state"
import { CampaignHashSchema, CampaignJobAttemptSchema } from "../state"
import { sha256 } from "../../workflow/stage-runner/sha256"

type PreparedJob = Extract<CampaignJobAttempt, { readonly phase: "PREPARED" }>

export function prepareCampaignJobAttempt(input: Readonly<{
  readonly state: ResearchCampaignStateV1
  readonly job_id: string
  readonly target: CampaignJobAttempt["target"]
  readonly role: string
  readonly resolved_model: CampaignJobAttempt["resolved_model"]
  readonly profile_sha256: CampaignJobAttempt["profile_sha256"]
  readonly prompt_sha256: CampaignJobAttempt["prompt_sha256"]
  readonly reference_sha256: CampaignJobAttempt["reference_sha256"]
  readonly input_sha256: CampaignJobAttempt["input_sha256"]
}>): PreparedJob {
  const preparedRevision = input.state.state_revision + 1
  const attemptNumber = input.state.job_attempts.filter((attempt) => sameTarget(attempt.target, input.target)).length + 1
  const idempotencyKey = CampaignHashSchema.parse(sha256([
    input.state.campaign_id,
    preparedRevision,
    input.job_id,
    targetIdentity(input.target),
    attemptNumber,
    input.role,
    input.resolved_model.providerID,
    input.resolved_model.modelID,
    input.resolved_model.variant ?? "",
    input.profile_sha256,
    input.prompt_sha256,
    input.reference_sha256,
    input.input_sha256,
  ].join("|")))
  const parsed = CampaignJobAttemptSchema.parse({
    job_id: input.job_id,
    target: input.target,
    attempt_number: attemptNumber,
    prepared_at_revision: preparedRevision,
    phase_revision: preparedRevision,
    idempotency_key: idempotencyKey,
    role: input.role,
    resolved_model: input.resolved_model,
    profile_sha256: input.profile_sha256,
    prompt_sha256: input.prompt_sha256,
    reference_sha256: input.reference_sha256,
    input_sha256: input.input_sha256,
    child_title: `[openmath-research:${idempotencyKey}] ${input.role} ${input.state.campaign_id} ${input.job_id}`,
    phase: "PREPARED",
  })
  if (parsed.phase !== "PREPARED") throw new TypeError("Prepared campaign job parsed to an unexpected phase")
  return parsed
}

function targetIdentity(target: CampaignJobAttempt["target"]): string {
  switch (target.kind) {
    case "CANDIDATE":
      return `CANDIDATE:${target.candidate_id}`
    case "SCREEN":
      return `SCREEN:${target.screen_id}:${target.candidate_id}`
    case "TOURNAMENT":
      return `TOURNAMENT:${target.tournament_id}`
    default:
      return assertNever(target)
  }
}

function sameTarget(left: CampaignJobAttempt["target"], right: CampaignJobAttempt["target"]): boolean {
  return targetIdentity(left) === targetIdentity(right)
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected campaign job target: ${String(value)}`)
}
