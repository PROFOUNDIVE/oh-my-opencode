import { z } from "zod"

import {
  CandidateArtifactReferenceSchema,
  CampaignPhaseSchema,
  CampaignStatusSchema,
  ResearchAwaitingReasonSchema,
  type CandidateDescriptor,
  type ResearchCampaignStateV1,
} from "../state"
import { getCampaignNextActions } from "../transitions"

export const CampaignErrorCodeSchema = z.enum([
  "VALIDATION_ERROR",
  "CAMPAIGN_NOT_FOUND",
  "CAMPAIGN_ALREADY_EXISTS",
  "PROFILE_NOT_FOUND",
  "ILLEGAL_TRANSITION",
  "STALE_STATE_REVISION",
  "SOURCE_ERROR",
  "STORAGE_READ_FAILED",
  "STORAGE_WRITE_FAILED",
  "STORAGE_BUSY",
  "STORAGE_ATOMICITY_UNAVAILABLE",
  "SUBAGENT_FAILED",
  "ADAPTER_OUTPUT_INVALID",
  "RECONCILIATION_BLOCKED",
  "CHILD_WORKFLOW_FAILED",
  "DOSSIER_HASH_MISMATCH",
  "ABORTED",
])

const CandidateSummarySchema = z.object({
  candidate_id: z.string(),
  strategy_id: z.string().nullable(),
  execution_status: z.enum(["PENDING", "RUNNING", "COMPLETED", "FAILED"]),
}).strict().readonly()

const NormalizedScreenSchema = z.object({
  screen_id: z.string(),
  screen_role: z.string(),
  verdict: z.enum(["VIABLE", "REPAIRABLE", "FATAL_FLAW", "INCONCLUSIVE"]),
  blocking_issues: z.array(z.string()).readonly(),
  unresolved_obligations: z.array(z.string()).readonly(),
  assumptions: z.array(z.string()).readonly(),
  novel_elements: z.array(z.string()).readonly(),
}).strict().readonly()

const CandidateDetailSchema = z.object({
  candidate_id: z.string(),
  candidate_kind: z.enum(["STRATEGY", "MERGE_IDEA"]),
  strategy_id: z.string().nullable(),
  parent_candidate_ids: z.array(z.string()).readonly(),
  artifact: CandidateArtifactReferenceSchema.nullable(),
  screens: z.array(NormalizedScreenSchema).readonly(),
}).strict().readonly()

const PublicDossierSchema = z.object({
  dossier_id: z.string(),
  campaign_id: z.string(),
  created_at_revision: z.number().int().nonnegative(),
  selected_candidate_id: z.string(),
  artifact: CandidateArtifactReferenceSchema,
  objective_sha256: z.string(),
  profile_sha256: z.string(),
  reference_sha256: z.string(),
  content_sha256: z.string(),
  storage_ref: z.string(),
  attachments: z.array(z.object({
    attachment_id: z.string(),
    kind: z.string(),
    schema_version: z.number().int().positive(),
    content_sha256: z.string(),
    storage_ref: z.string(),
  }).strict().readonly()).readonly(),
  canonical: z.literal(false),
  mathematical_correctness_certified: z.literal(false),
  human_approval_required: z.literal(true),
}).strict().readonly()

const CampaignNextActionSchema = z.object({
  action: z.enum(["step_one_stage", "step_to_checkpoint", "amend", "promote", "abort"]),
  required_state_revision: z.number().int().nonnegative(),
  reason: z.enum([
    "READY_TO_RUN",
    "RECONCILIATION_REQUIRED",
    "RECONCILIATION_BLOCKED",
    "HUMAN_CHECKPOINT",
    "AMENDMENT_REQUIRED",
    "PROMOTION_DECISION_REQUIRED",
  ]),
}).strict().readonly()

export const CampaignSuccessEnvelopeSchema = z.object({
  ok: z.literal(true),
  campaign_id: z.string(),
  state_revision: z.number().int().nonnegative(),
  phase: CampaignPhaseSchema,
  status: CampaignStatusSchema,
  awaiting_reason: ResearchAwaitingReasonSchema.nullable(),
  candidate_summaries: z.array(CandidateSummarySchema).readonly(),
  candidate_details: z.array(CandidateDetailSchema).readonly().nullable(),
  selected_candidate_id: z.string().nullable(),
  dossier: PublicDossierSchema.nullable(),
  next_actions: z.array(CampaignNextActionSchema).readonly(),
}).strict().readonly()

export const CampaignErrorEnvelopeSchema = z.object({
  ok: z.literal(false),
  error_code: CampaignErrorCodeSchema,
  message: z.string(),
  current_state_revision: z.number().int().nonnegative().optional(),
}).strict().readonly()

export type CampaignSuccessEnvelope = z.infer<typeof CampaignSuccessEnvelopeSchema>
export type CampaignErrorEnvelope = z.infer<typeof CampaignErrorEnvelopeSchema>
export type CampaignErrorCode = z.infer<typeof CampaignErrorCodeSchema>

export function campaignSuccessEnvelope(state: ResearchCampaignStateV1): CampaignSuccessEnvelope {
  return CampaignSuccessEnvelopeSchema.parse({
    ok: true,
    campaign_id: state.campaign_id,
    state_revision: state.state_revision,
    phase: state.phase,
    status: state.status,
    awaiting_reason: state.awaiting_reason,
    candidate_summaries: state.candidates.map((candidate) => candidateSummary(state, candidate)),
    candidate_details: screenBarrierPassed(state) ? state.candidates.map((candidate) => candidateDetail(state, candidate)) : null,
    selected_candidate_id: state.selected_candidate_id,
    dossier: publicDossier(state),
    next_actions: getCampaignNextActions(state),
  })
}

export function campaignErrorEnvelope(error: Readonly<{
  readonly error_code: CampaignErrorCode
  readonly message: string
  readonly current_state_revision?: number
}>): CampaignErrorEnvelope {
  return CampaignErrorEnvelopeSchema.parse({
    ok: false,
    error_code: error.error_code,
    message: error.message,
    ...(error.current_state_revision === undefined ? {} : { current_state_revision: error.current_state_revision }),
  })
}

function candidateSummary(state: ResearchCampaignStateV1, candidate: CandidateDescriptor) {
  return {
    candidate_id: candidate.candidate_id,
    strategy_id: candidate.candidate_kind === "STRATEGY" ? candidate.strategy_id : null,
    execution_status: candidateExecutionStatus(state, candidate),
  }
}

function candidateExecutionStatus(state: ResearchCampaignStateV1, candidate: CandidateDescriptor) {
  if (candidate.artifact !== null) return "COMPLETED" as const
  const jobs = state.job_attempts.filter((job) => job.target.kind === "CANDIDATE" && job.target.candidate_id === candidate.candidate_id)
  if (jobs.some((job) => state.active_job_ids.includes(job.job_id))) return "RUNNING" as const
  if (jobs.some((job) => (job.phase === "COMPLETED" || job.phase === "COMMITTED") && job.receipt.kind === "ERROR")) return "FAILED" as const
  return "PENDING" as const
}

function candidateDetail(state: ResearchCampaignStateV1, candidate: CandidateDescriptor) {
  return {
    candidate_id: candidate.candidate_id,
    candidate_kind: candidate.candidate_kind,
    strategy_id: candidate.candidate_kind === "STRATEGY" ? candidate.strategy_id : null,
    parent_candidate_ids: candidate.parent_candidate_ids,
    artifact: candidate.artifact,
    screens: state.screen_receipts
      .filter((screen) => screen.candidate_id === candidate.candidate_id)
      .map(({ screen_id, screen_role, verdict, blocking_issues, unresolved_obligations, assumptions, novel_elements }) => ({
        screen_id,
        screen_role,
        verdict,
        blocking_issues,
        unresolved_obligations,
        assumptions,
        novel_elements,
      })),
  }
}

function screenBarrierPassed(state: ResearchCampaignStateV1): boolean {
  if (state.phase === "TOURNAMENT" || state.phase === "DEEP_REFINEMENT" || state.phase === "PROMOTION") return true
  return state.phase === "SCREENING" && state.status === "AWAITING_HUMAN" && state.awaiting_reason === "AFTER_INITIAL_SCREEN"
}

function publicDossier(state: ResearchCampaignStateV1) {
  if (state.dossier === null || state.phase !== "PROMOTION") return null
  const visible = (state.status === "AWAITING_HUMAN" && state.awaiting_reason === "BEFORE_PROMOTION")
    || state.status === "PROMOTION_READY"
    || state.status === "REJECTED"
  if (!visible) return null
  return {
    dossier_id: state.dossier.dossier_id,
    campaign_id: state.dossier.campaign_id,
    created_at_revision: state.dossier.created_at_revision,
    selected_candidate_id: state.dossier.selected_candidate_id,
    artifact: state.dossier.artifact,
    objective_sha256: state.dossier.objective_sha256,
    profile_sha256: state.dossier.profile_sha256,
    reference_sha256: state.dossier.reference_sha256,
    content_sha256: state.dossier.content_sha256,
    storage_ref: state.dossier.storage_ref,
    attachments: state.dossier.attachments,
    canonical: false as const,
    mathematical_correctness_certified: false as const,
    human_approval_required: true as const,
  }
}
