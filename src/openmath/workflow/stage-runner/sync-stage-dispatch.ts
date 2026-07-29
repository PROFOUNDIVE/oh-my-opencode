import type { OpencodeClient, ToolContextWithMetadata } from "../../../tools/delegate-task/types"
import { runSyncSubagentText } from "../../../tools/openmath-solve-only/run-sync-subagent"
import type { StageSubagentDispatch } from "./stage-runner-types"

type SyncStageDispatchDependencies = Readonly<{
  readonly runSubagent: typeof runSyncSubagentText
}>

const syncStageDispatchDependencies: SyncStageDispatchDependencies = {
  runSubagent: runSyncSubagentText,
}

export function createSyncStageDispatch(
  input: Readonly<{
    readonly client: OpencodeClient
    readonly directory: string
    readonly ctx: ToolContextWithMetadata
  }>,
  dependencies: SyncStageDispatchDependencies = syncStageDispatchDependencies,
): (dispatch: StageSubagentDispatch) => Promise<
  | Readonly<{ readonly ok: true; readonly session_id: string; readonly text: string }>
  | Readonly<{ readonly ok: false; readonly error: string }>
> {
  return async (dispatch) => {
    const result = await dependencies.runSubagent({
      client: input.client,
      directory: input.directory,
      parentSessionID: dispatch.parent_session_id,
      ctx: input.ctx,
      agentToUse: dispatch.agent_to_use,
      description: dispatch.child_title,
      prompt: dispatch.user_prompt,
      persistedSessionID: dispatch.persisted_session_id,
      skipPrompt: !dispatch.send_prompt,
      childTitle: dispatch.child_title,
      promptMarker: dispatch.prompt_marker,
      categoryModel: dispatch.category_model,
      systemContent: dispatch.system_content,
      awaitedCallbacks: {
        onSessionCreated: dispatch.awaited_callbacks.on_session_created,
        onPromptSent: dispatch.awaited_callbacks.on_prompt_sent,
      },
    })
    return result.ok
      ? { ok: true, session_id: result.sessionID, text: result.text }
      : { ok: false, error: result.error }
  }
}
