import {
  CampaignHashSchema,
  CampaignJobAttemptSchema,
  ScreenReceiptSchema,
  TournamentReceiptSchema,
  type CampaignJobAttempt,
  type ResearchCampaignStateV1,
  type ScreenReceipt,
  type TournamentReceipt,
  type TournamentResult,
} from "../state"
import { ResearchCampaignStateV1Schema } from "../state"
import { buildCampaignSourceSnapshot } from "../application/build-campaign-source-snapshot"
import { objectiveSnapshot, profileSnapshot, referenceSnapshot } from "../application/application-test-fixture"
import { screen, tournament } from "../state/aggregate-test-fixture"

export const HASH_A = CampaignHashSchema.parse("a".repeat(64))
export const HASH_B = CampaignHashSchema.parse("b".repeat(64))

export function withValidScreeningSources(
  state: ResearchCampaignStateV1,
  survivorLimit = 1,
): ResearchCampaignStateV1 {
  const baseProfile = profileSnapshot()
  const sourceSnapshot = buildCampaignSourceSnapshot({
    objective: objectiveSnapshot(),
    profile: {
      ...baseProfile,
      survivor_limit: survivorLimit,
      screening_roles: baseProfile.screening_roles.map((role) => ({ ...role, id: "logical-soundness" })),
    },
    references: referenceSnapshot(),
  })
  return ResearchCampaignStateV1Schema.parse({
    ...state,
    source_snapshot: sourceSnapshot,
    job_attempts: state.job_attempts.map((job) => {
      let receiptOverride = {}
      if ((job.phase === "COMPLETED" || job.phase === "COMMITTED")
        && job.target.kind === "SCREEN" && job.receipt.kind === "SCREEN") {
        const screenId = job.target.screen_id
        const screen = state.screen_receipts.find((receipt) => receipt.screen_id === screenId)
        if (screen !== undefined) {
          receiptOverride = {
            receipt: { kind: "SCREEN", screen_id: job.receipt.screen_id, normalized_output: normalizedOutput(screen) },
          }
        }
      }
      return {
        ...job,
        profile_sha256: sourceSnapshot.profile.sha256,
        reference_sha256: sourceSnapshot.references.sha256,
        ...receiptOverride,
      }
    }),
    screen_receipts: state.screen_receipts.map((receipt) => ({
      ...receipt,
      profile_sha256: sourceSnapshot.profile.sha256,
      reference_sha256: sourceSnapshot.references.sha256,
    })),
    tournament_receipts: state.tournament_receipts.map((receipt) => ({
      ...receipt,
      screen_ids: receipt.screen_ids.slice(0, survivorLimit),
      profile_sha256: sourceSnapshot.profile.sha256,
      reference_sha256: sourceSnapshot.references.sha256,
    })),
  })
}

function normalizedOutput(receipt: ScreenReceipt) {
  return {
    verdict: receipt.verdict,
    blocking_issues: receipt.blocking_issues,
    unresolved_obligations: receipt.unresolved_obligations,
    assumptions: receipt.assumptions,
    novel_elements: receipt.novel_elements,
  }
}

export function preparedJob(
  state: ResearchCampaignStateV1,
  jobId: string,
  target: JobTargetInput,
): CampaignJobAttempt {
  const revision = state.state_revision + 1
  return CampaignJobAttemptSchema.parse({
    job_id: jobId,
    target,
    attempt_number: 1,
    prepared_at_revision: revision,
    phase_revision: revision,
    idempotency_key: HASH_A,
    role: "campaign-operation",
    resolved_model: { providerID: "openai", modelID: "gpt-5" },
    profile_sha256: state.source_snapshot.profile.sha256,
    prompt_sha256: HASH_A,
    reference_sha256: state.source_snapshot.references.sha256,
    input_sha256: HASH_A,
    child_title: `[openmath-research:${HASH_A}] ${jobId}`,
    phase: "PREPARED",
  })
}

export function completedJob(
  job: CampaignJobAttempt,
  phaseRevision: number,
  receipt: CampaignJobReceiptInput,
): CampaignJobAttempt {
  return CampaignJobAttemptSchema.parse({
    ...job,
    phase: "COMPLETED",
    phase_revision: phaseRevision,
    child_session_id: "ses_operation1",
    raw_output_sha256: HASH_A,
    receipt: receipt.kind === "SCREEN"
      ? {
          ...receipt,
          normalized_output: {
            verdict: "VIABLE",
            blocking_issues: [],
            unresolved_obligations: [],
            assumptions: [],
            novel_elements: [],
          },
        }
      : receipt,
  })
}

export function screenReceipt(job: CampaignJobAttempt, revision: number): ScreenReceipt {
  if ((job.phase !== "COMPLETED" && job.phase !== "COMMITTED") || job.target.kind !== "SCREEN") {
    throw new TypeError("Screen receipt fixture requires completed job evidence")
  }
  return ScreenReceiptSchema.parse({
    ...screen("direct-01", revision),
    screen_id: job.target.screen_id,
    job_id: job.job_id,
    campaign_revision: revision,
    reviewer_session_id: job.child_session_id,
    resolved_model: job.resolved_model,
    profile_sha256: job.profile_sha256,
    prompt_sha256: job.prompt_sha256,
    reference_sha256: job.reference_sha256,
    raw_output_sha256: job.raw_output_sha256,
  })
}

export function tournamentReceipt(job: CampaignJobAttempt, revision: number): TournamentReceipt {
  if ((job.phase !== "COMPLETED" && job.phase !== "COMMITTED") || job.target.kind !== "TOURNAMENT") {
    throw new TypeError("Tournament receipt fixture requires completed job evidence")
  }
  return TournamentReceiptSchema.parse({
    ...tournament(),
    tournament_id: job.target.tournament_id,
    job_id: job.job_id,
    campaign_revision: revision,
    reviewer_session_id: job.child_session_id,
    resolved_model: job.resolved_model,
    profile_sha256: job.profile_sha256,
    prompt_sha256: job.prompt_sha256,
    reference_sha256: job.reference_sha256,
    raw_output_sha256: job.raw_output_sha256,
  })
}

type JobTargetInput =
  | { readonly kind: "CANDIDATE"; readonly candidate_id: string }
  | { readonly kind: "SCREEN"; readonly screen_id: string; readonly candidate_id: string }
  | { readonly kind: "TOURNAMENT"; readonly tournament_id: string }

type CampaignJobReceiptInput =
  | { readonly kind: "CANDIDATE_ARTIFACT"; readonly candidate_id: string; readonly artifact_sha256: string }
  | { readonly kind: "SCREEN"; readonly screen_id: string }
  | { readonly kind: "TOURNAMENT"; readonly tournament_id: string; readonly result: TournamentResult }
  | { readonly kind: "ERROR"; readonly error_code: string; readonly message: string }
