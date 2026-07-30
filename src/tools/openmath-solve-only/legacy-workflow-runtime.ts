import type { OpencodeClient, ToolContextWithMetadata } from "../delegate-task/types"
import { writeOpenMathSessionState, type OpenMathStateFilenameMode } from "../../openmath/storage"
import { projectWorkflowStateToLegacy, WorkflowStateV1Schema, type WorkflowStateV1 } from "../../openmath/workflow/state"
import { compareAndSwapWorkflowState } from "../../openmath/workflow/storage"
import type { StageRunnerRuntime, StageSubagentDispatch } from "../../openmath/workflow/stage-runner"
import { StagePersistenceError } from "../../openmath/workflow/stage-runner/stage-persistence-error"
import { runSyncSubagentText } from "./run-sync-subagent"

export function createLegacyWorkflowRuntime(input: Readonly<{
  readonly state: WorkflowStateV1
  readonly directory: string
  readonly client: OpencodeClient
  readonly ctx: ToolContextWithMetadata
  readonly state_filename_mode: OpenMathStateFilenameMode
}>): StageRunnerRuntime {
  let currentState = input.state
  const childTitles = new Map<string, string>()
  const childMessages = new Map<string, string>()
  return {
    persist: async (nextState) => {
      const normalizedState = recordSuccessfulLegacyRevision(currentState, nextState)
      const result = await compareAndSwapWorkflowState({
        directory: input.directory,
        run_id: currentState.run_id,
        expected_state_revision: currentState.state_revision,
        next_state: normalizedState,
      })
      if (result.kind === "error") {
        const parsed = WorkflowStateV1Schema.safeParse({ ...normalizedState, state_revision: currentState.state_revision + 1 })
        const message = parsed.success ? result.message : parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")
        throw new StagePersistenceError(result.error_code, message)
      }
      currentState = result.state
      persistLegacyProjection(input.directory, input.state_filename_mode, currentState)
      return currentState
    },
    list_children: async (parentSessionID) => {
      const local = [...childTitles.keys()].map((id) => ({ id }))
      const sessionApi = input.client.session
      if (sessionApi === undefined) return local
      const result = await sessionApi.children({ path: { id: parentSessionID }, query: { directory: input.directory } })
      if (result.error) throw new Error(`Unable to list child sessions: ${String(result.error)}`)
      const ids = new Set(local.map((child) => child.id))
      return [...local, ...result.data.filter((child) => !ids.has(child.id)).map((child) => ({ id: child.id }))]
    },
    get_session: async (sessionID) => {
      const local = childTitles.get(sessionID)
      if (local !== undefined) return { title: local }
      const sessionApi = input.client.session
      if (sessionApi === undefined) return { title: "" }
      const result = await sessionApi.get({ path: { id: sessionID }, query: { directory: input.directory } })
      if (result.error) throw new Error(`Unable to inspect child session: ${String(result.error)}`)
      return { title: result.data.title }
    },
    list_messages: async (sessionID) => {
      const local = childMessages.get(sessionID)
      if (local !== undefined) return [{ role: "user", text: local }]
      const sessionApi = input.client.session
      if (sessionApi === undefined) return []
      const result = await sessionApi.messages({ path: { id: sessionID }, query: { directory: input.directory } })
      if (result.error) throw new Error(`Unable to inspect child transcript: ${String(result.error)}`)
      return result.data.map((message) => ({
        role: message.info.role,
        text: message.parts.filter((part) => part.type === "text").map((part) => part.text).join(""),
      }))
    },
    dispatch: (dispatch) => dispatchLegacyStage(input, dispatch, childTitles, childMessages, currentState),
  }
}

function recordSuccessfulLegacyRevision(current: WorkflowStateV1, next: WorkflowStateV1): WorkflowStateV1 {
  if (current.next_stage !== "REVISE" || current.legacy_projection.kind !== "solve_only") return next
  const fallback = current.legacy_projection.markdown_fallback
  if (fallback === null || next.status !== "READY" || next.next_stage !== "REVIEW") return next
  const attempt = next.dispatch_attempts.findLast((candidate) => candidate.phase === "COMMITTED")
  if (attempt?.phase !== "COMMITTED" || attempt.stage !== "REVISE" || attempt.receipt.kind !== "ARTIFACT") return next
  const kind = fallback.regenerate_next ? "regeneration" as const : "patch" as const
  return {
    ...next,
    legacy_projection: {
      ...current.legacy_projection,
      markdown_fallback: {
        ...fallback,
        consecutive_failures: 0,
        last_error_code: null,
        last_section_id: null,
        regenerate_next: false,
        sub_attempt_history: [...fallback.sub_attempt_history, {
          kind,
          review_round: current.review_round,
          outcome: "COMPLETED",
          error_code: null,
          section_id: null,
        }],
      },
    },
  }
}

async function dispatchLegacyStage(
  input: Readonly<{ readonly client: OpencodeClient; readonly directory: string; readonly ctx: ToolContextWithMetadata }>,
  dispatch: StageSubagentDispatch,
  childTitles: Map<string, string>,
  childMessages: Map<string, string>,
  state: WorkflowStateV1,
): Promise<
  | Readonly<{ readonly ok: true; readonly session_id: string; readonly text: string }>
  | Readonly<{ readonly ok: false; readonly error: string; readonly error_code?: "SOLVER_PATCH_FAILED" }>
> {
  let sessionID = dispatch.persisted_session_id
  let promptPersisted = false
  const result = await runSyncSubagentText({
    client: input.client,
    directory: input.directory,
    parentSessionID: dispatch.parent_session_id,
    ctx: input.ctx,
    agentToUse: dispatch.agent_to_use,
    description: legacyDescription(state, dispatch.agent_to_use),
    prompt: dispatch.user_prompt,
    persistedSessionID: dispatch.persisted_session_id,
    skipPrompt: !dispatch.send_prompt,
    childTitle: dispatch.child_title,
    promptMarker: dispatch.prompt_marker,
    awaitedCallbacks: {
      onSessionCreated: async (createdSessionID) => {
        sessionID = createdSessionID
        childTitles.set(createdSessionID, dispatch.child_title)
        await dispatch.awaited_callbacks.on_session_created?.(createdSessionID)
      },
      onPromptSent: async (sentSessionID) => {
        sessionID = sentSessionID
        promptPersisted = true
        childMessages.set(sentSessionID, dispatch.prompt_marker)
        await dispatch.awaited_callbacks.on_prompt_sent?.(sentSessionID)
      },
    },
  })
  const resolvedSessionID = result.ok ? result.sessionID : sessionID ?? `legacy-${dispatch.prompt_marker.slice(22, 38)}`
  if (sessionID === undefined) {
    childTitles.set(resolvedSessionID, dispatch.child_title)
    await dispatch.awaited_callbacks.on_session_created?.(resolvedSessionID)
  }
  if (!promptPersisted && dispatch.send_prompt) {
    childMessages.set(resolvedSessionID, dispatch.prompt_marker)
    await dispatch.awaited_callbacks.on_prompt_sent?.(resolvedSessionID)
  }
  return result.ok
    ? { ok: true, session_id: resolvedSessionID, text: result.text }
    : {
        ok: false,
        error: result.error,
        ...(state.profile_snapshot.name === "legacy-educational-markdown"
          && state.legacy_projection.kind === "solve_only"
          && state.next_stage === "REVISE"
          && dispatch.agent_to_use === "solver-markdown-patch"
          ? { error_code: "SOLVER_PATCH_FAILED" as const }
          : {}),
      }
}

function legacyDescription(state: WorkflowStateV1, agent: string): string {
  const problemId = state.run_id.split("::").at(-1) ?? state.run_id
  const action = state.next_stage === "REVIEW" ? "review" : agent === "solver-markdown-patch" ? "patch" : "solve"
  return `OpenMath solve-only: ${action} ${problemId} (round ${state.review_round})`
}

function persistLegacyProjection(
  directory: string,
  mode: OpenMathStateFilenameMode,
  state: WorkflowStateV1,
): void {
  if (state.legacy_projection.kind !== "solve_only") return
  const projected = projectWorkflowStateToLegacy(state)
  if (projected.kind === "error" || !writeOpenMathSessionState(directory, projected.state, mode)) {
    throw new StagePersistenceError("STORAGE_WRITE_FAILED", "Unable to persist legacy workflow projection")
  }
}
