import { z } from "zod"

export const EnabledCampaignErrorCodeSchema = z.enum([
  "VALIDATION_ERROR",
  "CAMPAIGN_NOT_FOUND",
  "CAMPAIGN_ALREADY_EXISTS",
  "PROFILE_NOT_FOUND",
  "CAMPAIGN_NOT_ELIGIBLE",
  "CERTIFICATION_ALREADY_EXISTS",
  "CERTIFICATION_NOT_FOUND",
  "PROFILE_HASH_MISMATCH",
  "ILLEGAL_TRANSITION",
  "STALE_STATE_REVISION",
  "STALE_CERTIFICATION_REVISION",
  "STALE_ARTIFACT",
  "STALE_GRAPH",
  "SOURCE_ERROR",
  "STORAGE_READ_FAILED",
  "STORAGE_WRITE_FAILED",
  "STORAGE_BUSY",
  "STORAGE_ATOMICITY_UNAVAILABLE",
  "SUBAGENT_FAILED",
  "ADAPTER_OUTPUT_INVALID",
  "RECONCILIATION_AMBIGUOUS",
  "RECONCILIATION_BLOCKED",
  "CHILD_WORKFLOW_FAILED",
  "DOSSIER_HASH_MISMATCH",
  "SIDECAR_CLEANUP_FAILED",
  "ABORTED",
])

export const EnabledCampaignErrorEnvelopeSchema = z.object({
  ok: z.literal(false),
  error_code: EnabledCampaignErrorCodeSchema,
  message: z.string(),
  current_state_revision: z.number().int().nonnegative().optional(),
  current_certification_revision: z.number().int().nonnegative().optional(),
  campaign_aborted: z.literal(true).optional(),
}).strict().readonly()

export type EnabledCampaignErrorEnvelope = z.infer<typeof EnabledCampaignErrorEnvelopeSchema>
export type EnabledCampaignErrorCode = z.infer<typeof EnabledCampaignErrorCodeSchema>

export function enabledCampaignErrorEnvelope(error: Readonly<{
  readonly error_code: EnabledCampaignErrorCode
  readonly message: string
  readonly current_state_revision?: number
  readonly current_certification_revision?: number
  readonly campaign_aborted?: true
}>): EnabledCampaignErrorEnvelope {
  return EnabledCampaignErrorEnvelopeSchema.parse({
    ok: false,
    error_code: error.error_code,
    message: error.message,
    ...(error.current_state_revision === undefined ? {} : { current_state_revision: error.current_state_revision }),
    ...(error.current_certification_revision === undefined ? {} : { current_certification_revision: error.current_certification_revision }),
    ...(error.campaign_aborted === undefined ? {} : { campaign_aborted: true }),
  })
}
