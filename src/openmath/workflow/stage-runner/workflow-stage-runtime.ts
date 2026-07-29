import type { OpencodeClient, ToolContextWithMetadata } from "../../../tools/delegate-task/types"
import { compareAndSwapWorkflowState } from "../storage"
import type { WorkflowStateV1 } from "../state"
import { StagePersistenceError } from "./stage-persistence-error"
import { createSyncStageDispatch } from "./sync-stage-dispatch"
import type { StageRunnerRuntime } from "./stage-runner-types"

type WorkflowStageRuntimeDependencies = Readonly<{
  readonly compareAndSwap: typeof compareAndSwapWorkflowState
}>

const workflowStageRuntimeDependencies: WorkflowStageRuntimeDependencies = {
  compareAndSwap: compareAndSwapWorkflowState,
}

export function createWorkflowStageRuntime(
  input: Readonly<{
    readonly state: WorkflowStateV1
    readonly directory: string
    readonly client: OpencodeClient
    readonly ctx: ToolContextWithMetadata
  }>,
  dependencies: WorkflowStageRuntimeDependencies = workflowStageRuntimeDependencies,
): StageRunnerRuntime {
  let currentState = input.state
  return {
    persist: async (nextState) => {
      const result = await dependencies.compareAndSwap({
        directory: input.directory,
        run_id: currentState.run_id,
        expected_state_revision: currentState.state_revision,
        next_state: nextState,
      })
      if (result.kind === "error") throw new StagePersistenceError(result.error_code, result.message)
      currentState = result.state
      return currentState
    },
    list_children: async (parentSessionID) => {
      const result = await input.client.session.children({
        path: { id: parentSessionID },
        query: { directory: input.directory },
      })
      if (result.error) throw new Error(`Unable to list child sessions: ${String(result.error)}`)
      return result.data.map((child) => ({ id: child.id }))
    },
    get_session: async (sessionID) => {
      const result = await input.client.session.get({
        path: { id: sessionID },
        query: { directory: input.directory },
      })
      if (result.error) throw new Error(`Unable to inspect child session: ${String(result.error)}`)
      return { title: result.data.title }
    },
    list_messages: async (sessionID) => {
      const result = await input.client.session.messages({
        path: { id: sessionID },
        query: { directory: input.directory },
      })
      if (result.error) throw new Error(`Unable to inspect child transcript: ${String(result.error)}`)
      return result.data.map((message) => ({
        role: message.info.role,
        text: message.parts
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join(""),
      }))
    },
    dispatch: createSyncStageDispatch({ client: input.client, directory: input.directory, ctx: input.ctx }),
  }
}
