import { compareAndSwapWorkflowState } from "../../workflow/storage"
import type { StageRunnerRuntime } from "../../workflow/stage-runner"
import { StagePersistenceError } from "../../workflow/stage-runner/stage-persistence-error"
import type { WorkflowStateV1 } from "../../workflow/state"
import type { CampaignErrorCode } from "../application"
import type { CampaignJobAttempt } from "../state"
import type { CampaignJobRuntime } from "../scheduler"

export type CandidateWorkflowRuntime = Readonly<{
  readonly runtime: StageRunnerRuntime
  readonly campaign_attempt: () => CampaignJobAttempt
  readonly synchronize_prompt_receipt: (sessionID: string) => Promise<CampaignJobAttempt>
}>

export function createCandidateWorkflowRuntime(input: Readonly<{
  readonly directory: string
  readonly state: WorkflowStateV1
  readonly attempt: CampaignJobAttempt
  readonly job_runtime: CampaignJobRuntime
}>): CandidateWorkflowRuntime {
  let workflowState = input.state
  let campaignAttempt = input.attempt

  const persistCampaign = async (update: Parameters<CampaignJobRuntime["persist_job_attempt"]>[0]): Promise<void> => {
    const result = await input.job_runtime.persist_job_attempt(update)
    if (!result.ok) throw new CandidateCampaignPersistenceError(result.error_code, result.message)
    campaignAttempt = result.attempt
  }
  const synchronizePromptReceipt = async (sessionID: string): Promise<CampaignJobAttempt> => {
    if (campaignAttempt.phase === "PREPARED") {
      await persistCampaign({ phase: "SESSION_CREATED", job_id: campaignAttempt.job_id, child_session_id: sessionID })
    }
    if (campaignAttempt.phase === "SESSION_CREATED") {
      await persistCampaign({ phase: "PROMPT_SENT", job_id: campaignAttempt.job_id, child_session_id: sessionID })
    }
    return campaignAttempt
  }

  return {
    campaign_attempt: () => campaignAttempt,
    synchronize_prompt_receipt: synchronizePromptReceipt,
    runtime: {
      persist: async (nextState) => {
        const result = await compareAndSwapWorkflowState({
          directory: input.directory,
          run_id: workflowState.run_id,
          expected_state_revision: workflowState.state_revision,
          next_state: nextState,
        })
        if (result.kind === "error") throw new StagePersistenceError(result.error_code, result.message)
        workflowState = result.state
        return workflowState
      },
      list_children: input.job_runtime.list_children,
      get_session: input.job_runtime.get_session,
      list_messages: input.job_runtime.list_messages,
      dispatch: async (request) => input.job_runtime.dispatch({
        ...request,
        awaited_callbacks: {
          on_session_created: async (sessionID) => {
            await request.awaited_callbacks.on_session_created?.(sessionID)
            if (campaignAttempt.phase === "PREPARED") {
              await persistCampaign({ phase: "SESSION_CREATED", job_id: campaignAttempt.job_id, child_session_id: sessionID })
            }
          },
          on_prompt_sent: async (sessionID) => {
            await request.awaited_callbacks.on_prompt_sent?.(sessionID)
            await synchronizePromptReceipt(sessionID)
          },
        },
      }),
    },
  }
}

export class CandidateCampaignPersistenceError extends Error {
  readonly name = "CandidateCampaignPersistenceError"

  constructor(readonly error_code: CampaignErrorCode, message: string) {
    super(message)
  }
}
