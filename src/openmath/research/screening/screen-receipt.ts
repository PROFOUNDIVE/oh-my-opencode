import { sha256 } from "../../workflow/stage-runner/sha256"
import type { WorkflowStateV1 } from "../../workflow/state"
import { CampaignHashSchema, ScreenReceiptSchema, type ScreenReceipt } from "../state"
import { adaptScreenOutput, type ScreenOutputAdapterError } from "./screen-output-adapter"

export type BuildScreenReceiptInput = Readonly<{
  readonly screen_id: ScreenReceipt["screen_id"]
  readonly job_id: ScreenReceipt["job_id"]
  readonly campaign_revision: ScreenReceipt["campaign_revision"]
  readonly candidate_id: ScreenReceipt["candidate_id"]
  readonly target_artifact: NonNullable<WorkflowStateV1["artifact"]>
  readonly artifact: ScreenReceipt["artifact"]
  readonly screen_role: ScreenReceipt["screen_role"]
  readonly reviewer_session_id: ScreenReceipt["reviewer_session_id"]
  readonly resolved_model: ScreenReceipt["resolved_model"]
  readonly profile_sha256: ScreenReceipt["profile_sha256"]
  readonly prompt_sha256: ScreenReceipt["prompt_sha256"]
  readonly reference_sha256: ScreenReceipt["reference_sha256"]
  readonly raw_output: string
}>

export type ScreenReceiptBuildResult =
  | Readonly<{ readonly ok: true; readonly receipt: ScreenReceipt }>
  | Readonly<{ readonly ok: false; readonly error: ScreenOutputAdapterError }>
  | Readonly<{
      readonly ok: false
      readonly error: Readonly<{ readonly code: "ARTIFACT_HASH_MISMATCH"; readonly message: string }>
    }>

export function buildScreenReceipt(input: BuildScreenReceiptInput): ScreenReceiptBuildResult {
  const artifactHash = CampaignHashSchema.parse(sha256(input.target_artifact.content))
  if (input.target_artifact.sha256 !== artifactHash
    || input.artifact.sha256 !== artifactHash
    || input.target_artifact.version !== input.artifact.artifact_version
    || input.target_artifact.media_type !== input.artifact.media_type) {
    return {
      ok: false,
      error: { code: "ARTIFACT_HASH_MISMATCH", message: "Screen target artifact bytes do not match its reference" },
    }
  }
  const adapted = adaptScreenOutput(input.raw_output)
  if (!adapted.ok) return adapted
  const receipt = ScreenReceiptSchema.parse({
    screen_id: input.screen_id,
    job_id: input.job_id,
    campaign_revision: input.campaign_revision,
    candidate_id: input.candidate_id,
    artifact: input.artifact,
    screen_role: input.screen_role,
    verdict: adapted.output.verdict,
    blocking_issues: adapted.output.blocking_issues,
    unresolved_obligations: adapted.output.unresolved_obligations,
    assumptions: adapted.output.assumptions,
    novel_elements: adapted.output.novel_elements,
    reviewer_session_id: input.reviewer_session_id,
    resolved_model: input.resolved_model,
    profile_sha256: input.profile_sha256,
    prompt_sha256: input.prompt_sha256,
    reference_sha256: input.reference_sha256,
    raw_output_sha256: CampaignHashSchema.parse(sha256(input.raw_output)),
  })
  return { ok: true, receipt }
}
