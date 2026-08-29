import type {
  CampaignJobDispatch,
  CampaignJobLifecycleUpdate,
  CampaignJobRuntime,
} from "../scheduler"
import type { CampaignPhase } from "../state"

export const FACTORY_CRASH_BOUNDARIES = [
  "CHILD_CREATED",
  "SESSION_CREATED",
  "PROMPT_APPENDED",
  "PROMPT_SENT",
  "OUTPUT_FETCHED",
  "COMPLETED",
] as const

export type FactoryCrashBoundary = typeof FACTORY_CRASH_BOUNDARIES[number]
export type RecoverableCampaignPhase = Exclude<CampaignPhase, "PROMOTION">

type CrashTarget = Readonly<{
  readonly phase: RecoverableCampaignPhase
  readonly boundary: FactoryCrashBoundary
}>

export function createRestartableFactoryTransport() {
  const children = new Map<string, string>()
  const messages = new Map<string, string>()
  const results = new Map<string, Awaited<ReturnType<CampaignJobRuntime["dispatch"]>>>()
  const externalDispatches = new Map<RecoverableCampaignPhase, number>()
  const completedJobs = new Set<string>()
  let childCreations = 0
  let promptAppends = 0
  let completionWrites = 0
  let target: CrashTarget | null = null
  let crashed = false

  return {
    arm: (next: CrashTarget) => {
      target = next
      crashed = false
    },
    decorate: (phase: RecoverableCampaignPhase, runtime: CampaignJobRuntime): CampaignJobRuntime => ({
      ...runtime,
      list_children: async () => [...children.keys()].map((id) => ({ id })),
      get_session: async (sessionID) => ({ title: children.get(sessionID) ?? "unknown" }),
      list_messages: async (sessionID) => {
        const text = messages.get(sessionID)
        return text === undefined ? [] : [{ role: "user", text }]
      },
      persist_job_attempt: async (update) => {
        const persisted = await runtime.persist_job_attempt(update)
        if (persisted.ok && update.phase === "COMPLETED") {
          completedJobs.add(update.job_id)
          completionWrites += 1
        }
        crashAfter(phase, update.phase, target, () => { crashed = true })
        return persisted
      },
      dispatch: async (request) => dispatch(phase, request, runtime),
    }),
    snapshot: () => ({
      children: children.size,
      prompts: messages.size,
      completed_jobs: completedJobs.size,
      child_creations: childCreations,
      prompt_appends: promptAppends,
      completion_writes: completionWrites,
      external_dispatches: Object.fromEntries(externalDispatches),
    }),
  }

  async function dispatch(
    phase: RecoverableCampaignPhase,
    request: CampaignJobDispatch,
    runtime: CampaignJobRuntime,
  ): ReturnType<CampaignJobRuntime["dispatch"]> {
    const cached = results.get(request.child_title)
    if (!request.send_prompt && cached !== undefined) return cached
    externalDispatches.set(phase, (externalDispatches.get(phase) ?? 0) + 1)
    const wrapped: CampaignJobDispatch = {
      ...request,
      awaited_callbacks: {
        on_session_created: async (sessionID) => {
          if (request.persisted_session_id === undefined) childCreations += 1
          children.set(sessionID, request.child_title)
          crashAfter(phase, "CHILD_CREATED", target, () => { crashed = true })
          await request.awaited_callbacks.on_session_created?.(sessionID)
          crashAfter(phase, "SESSION_CREATED", target, () => { crashed = true })
        },
        on_prompt_sent: async (sessionID) => {
          if (request.send_prompt) {
            promptAppends += 1
            messages.set(sessionID, `${request.prompt_marker}${request.user_prompt}`)
          }
          crashAfter(phase, "PROMPT_APPENDED", target, () => { crashed = true })
          await request.awaited_callbacks.on_prompt_sent?.(sessionID)
          crashAfter(phase, "PROMPT_SENT", target, () => { crashed = true })
        },
      },
    }
    const result = await runtime.dispatch(wrapped)
    results.set(request.child_title, result)
    crashAfter(phase, "OUTPUT_FETCHED", target, () => { crashed = true })
    return result
  }

  function crashAfter(
    phase: RecoverableCampaignPhase,
    boundary: FactoryCrashBoundary | CampaignJobLifecycleUpdate["phase"],
    active: CrashTarget | null,
    mark: () => void,
  ): void {
    if (crashed || active?.phase !== phase || active.boundary !== boundary) return
    mark()
    throw new Error(`crash after ${active.phase}/${active.boundary}`)
  }
}
