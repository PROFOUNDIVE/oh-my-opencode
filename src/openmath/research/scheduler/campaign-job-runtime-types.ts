import type { CampaignJobAttempt, ResearchCampaignStateV1 } from "../state"
import type { CampaignErrorCode } from "../application/campaign-envelope"

type CompletedJob = Extract<CampaignJobAttempt, { readonly phase: "COMPLETED" }>

export type CampaignJobLifecycleUpdate =
  | {
      readonly phase: "SESSION_CREATED"
      readonly job_id: CampaignJobAttempt["job_id"]
      readonly child_session_id: string
    }
  | {
      readonly phase: "PROMPT_SENT"
      readonly job_id: CampaignJobAttempt["job_id"]
      readonly child_session_id: string
    }
  | {
      readonly phase: "COMPLETED"
      readonly job_id: CampaignJobAttempt["job_id"]
      readonly child_session_id: string
      readonly raw_output_sha256: string
      readonly receipt: CompletedJob["receipt"]
    }

export type CampaignJobPersistenceResult =
  | { readonly ok: true; readonly attempt: CampaignJobAttempt; readonly state?: ResearchCampaignStateV1 }
  | { readonly ok: false; readonly error_code: CampaignErrorCode; readonly message: string }

export type CampaignJobBlockResult =
  | { readonly ok: true; readonly state?: ResearchCampaignStateV1 }
  | { readonly ok: false; readonly error_code: CampaignErrorCode; readonly message: string }

export type CampaignJobDispatch = Readonly<{
  readonly parent_session_id: string
  readonly child_title: string
  readonly agent_to_use: string
  readonly category_model: CampaignJobAttempt["resolved_model"]
  readonly system_content: string | undefined
  readonly user_prompt: string
  readonly prompt_marker: string
  readonly persisted_session_id: string | undefined
  readonly send_prompt: boolean
  readonly awaited_callbacks: Readonly<{
    readonly on_session_created?: (sessionID: string) => Promise<void>
    readonly on_prompt_sent?: (sessionID: string) => Promise<void>
  }>
}>

export type CampaignJobRuntime = Readonly<{
  readonly persist_job_attempt: (update: CampaignJobLifecycleUpdate) => Promise<CampaignJobPersistenceResult>
  readonly block_reconciliation: (input: Readonly<{ readonly job_id: CampaignJobAttempt["job_id"]; readonly message: string }>) => Promise<CampaignJobBlockResult>
  readonly list_children: (parentSessionID: string) => Promise<readonly Readonly<{ readonly id: string }>[]>
  readonly get_session: (sessionID: string) => Promise<Readonly<{ readonly title: string }>>
  readonly list_messages: (sessionID: string) => Promise<readonly Readonly<{ readonly role: string; readonly text: string }>[]>
  readonly dispatch: (input: CampaignJobDispatch) => Promise<
    | { readonly ok: true; readonly session_id: string; readonly text: string }
    | { readonly ok: false; readonly error: string }
  >
}>
