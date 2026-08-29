import {
  blockCampaignJobReconciliation,
  commitCampaignJobLifecycle,
} from "../application/commit-campaign-job-lifecycle"
import { readResearchCampaignState } from "../storage"
import type { CampaignJobAttempt } from "../state"
import type {
  CampaignJobLifecycleUpdate,
  CampaignJobRuntime,
} from "./campaign-job-runtime-types"

export type CampaignJobCrashBoundary =
  | "CHILD_CREATED"
  | "SESSION_CREATED"
  | "PROMPT_APPENDED"
  | "PROMPT_SENT"
  | "OUTPUT_FETCHED"
  | "COMPLETED"

export function createCampaignJobCrashRuntime(input: Readonly<{
  readonly directory: string
  readonly campaign_id: string
  readonly initial_attempt: CampaignJobAttempt
  readonly boundary: CampaignJobCrashBoundary
}>) {
  let crash: CampaignJobCrashBoundary | null = input.boundary
  const children: string[] = []
  const messages: string[] = []
  const phase_history: string[] = [input.initial_attempt.phase]
  let child_created = 0
  let prompt_sent = 0

  const persist = async (update: CampaignJobLifecycleUpdate) => {
    if (crash === sideEffectBoundary(update.phase)) {
      const crashed = crash
      crash = null
      throw new Error(`crash after ${crashed}`)
    }
    const result = await commitCampaignJobLifecycle({
      directory: input.directory,
      campaign_id: input.campaign_id,
      update,
    })
    if (!result.ok) return result
    phase_history.push(result.attempt.phase)
    if (crash === update.phase) {
      const crashed = crash
      crash = null
      throw new Error(`crash after ${crashed}`)
    }
    return result
  }

  const runtime: CampaignJobRuntime = {
    persist_job_attempt: persist,
    block_reconciliation: async (request) => blockCampaignJobReconciliation({
      directory: input.directory,
      campaign_id: input.campaign_id,
      ...request,
    }),
    list_children: async () => children.map((id) => ({ id })),
    get_session: async () => ({ title: input.initial_attempt.child_title }),
    list_messages: async () => messages.map((text) => ({ role: "user", text })),
    dispatch: async (request) => {
      const sessionID = request.persisted_session_id ?? "ses_child1"
      if (request.persisted_session_id === undefined) {
        child_created += 1
        children.push(sessionID)
        await request.awaited_callbacks.on_session_created?.(sessionID)
      }
      if (request.send_prompt) {
        prompt_sent += 1
        messages.push(`${request.prompt_marker}${request.user_prompt}`)
        await request.awaited_callbacks.on_prompt_sent?.(sessionID)
      }
      if (crash === "OUTPUT_FETCHED") {
        crash = null
        throw new Error("crash after OUTPUT_FETCHED")
      }
      return { ok: true, session_id: sessionID, text: "artifact output" }
    },
  }

  return {
    runtime,
    current_attempt: async () => {
      const state = await readResearchCampaignState(input.directory, input.campaign_id)
      if (state.kind === "error") throw new Error(state.message)
      const attempt = state.state.job_attempts.find((job) => job.job_id === input.initial_attempt.job_id)
      if (attempt === undefined) throw new TypeError("Expected persisted campaign job")
      return attempt
    },
    phase_history,
    counts: () => ({ child_created, prompt_sent }),
  }
}

function sideEffectBoundary(phase: CampaignJobLifecycleUpdate["phase"]): CampaignJobCrashBoundary {
  switch (phase) {
    case "SESSION_CREATED":
      return "CHILD_CREATED"
    case "PROMPT_SENT":
      return "PROMPT_APPENDED"
    case "COMPLETED":
      return "OUTPUT_FETCHED"
    default:
      return assertNever(phase)
  }
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected campaign job test variant: ${String(value)}`)
}
