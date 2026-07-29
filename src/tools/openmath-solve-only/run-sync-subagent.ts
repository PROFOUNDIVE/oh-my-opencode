import type { SyncTaskDeps } from "../delegate-task/sync-task-deps"
import { syncTaskDeps } from "../delegate-task/sync-task-deps"
import type { DelegateTaskArgs, OpencodeClient, ToolContextWithMetadata } from "../delegate-task/types"
import { subagentSessions } from "../../features/claude-code-session-state"

type CategoryModel = Readonly<{ readonly providerID: string; readonly modelID: string; readonly variant?: string }>

type AwaitedCallbacks = Readonly<{
  readonly onSessionCreated?: (sessionID: string) => Promise<void>
  readonly onPromptSent?: (sessionID: string) => Promise<void>
}>

class LifecyclePersistenceError extends Error {
  readonly name = "LifecyclePersistenceError"

  constructor(readonly original: unknown) {
    super(original instanceof Error ? original.message : String(original))
  }
}

function isAgentNotFoundError(error: string): boolean {
  const lowered = error.toLowerCase()
  return lowered.includes("agent \"") && lowered.includes("not found")
}

export async function runSyncSubagentText(
  args: {
    client: OpencodeClient
    directory: string
    parentSessionID: string
    ctx: ToolContextWithMetadata
    agentToUse: string
    description: string
    prompt: string
    excludeReasoningParts?: boolean
    persistedSessionID?: string
    skipPrompt?: boolean
    childTitle?: string
    promptMarker?: string
    systemContent?: string
    categoryModel?: CategoryModel
    awaitedCallbacks?: AwaitedCallbacks
  },
  deps: SyncTaskDeps = syncTaskDeps,
): Promise<{ ok: true; sessionID: string; text: string } | { ok: false; error: string; error_code?: string }> {
  let syncSessionID: string | null = null

  try {
    if (args.persistedSessionID) {
      syncSessionID = args.persistedSessionID
    } else {
      const createResult = await deps.createSyncSession(args.client, {
        parentSessionID: args.parentSessionID,
        agentToUse: args.agentToUse,
        description: args.description,
        defaultDirectory: args.directory,
        title: args.childTitle,
      })
      if (!createResult.ok) return { ok: false, error: createResult.error }
      syncSessionID = createResult.sessionID
      await runLifecycleCallback(args.awaitedCallbacks?.onSessionCreated, syncSessionID)
    }
    subagentSessions.add(syncSessionID)

    const delegateArgs: DelegateTaskArgs = {
      description: args.description,
      prompt: `${args.promptMarker ?? ""}${args.prompt}`,
      run_in_background: false,
      load_skills: [],
      command: undefined,
    }

    if (!args.skipPrompt) {
      const promptError = await deps.sendSyncPrompt(args.client, {
        sessionID: syncSessionID,
        agentToUse: args.agentToUse,
        args: delegateArgs,
        systemContent: args.systemContent,
        categoryModel: args.categoryModel,
        toastManager: null,
        taskId: undefined,
      })

      if (promptError) {
        return { ok: false, error: promptError, ...(isAgentNotFoundError(promptError) ? { error_code: "AGENT_NOT_FOUND" } : {}) }
      }
      await runLifecycleCallback(args.awaitedCallbacks?.onPromptSent, syncSessionID)
    }

    const pollError = await deps.pollSyncSession(args.ctx, args.client, {
      sessionID: syncSessionID,
      agentToUse: args.agentToUse,
      toastManager: null,
      taskId: undefined,
    })

    if (pollError) {
      return { ok: false, error: pollError }
    }

    const result = await deps.fetchSyncResult(args.client, syncSessionID, undefined, {
      excludeReasoningParts: args.excludeReasoningParts,
    })
    if (!result.ok) {
      return { ok: false, error: result.error }
    }

    return { ok: true, sessionID: syncSessionID, text: result.textContent }
  } catch (error) {
    if (error instanceof LifecyclePersistenceError) throw error.original
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: message }
  } finally {
    if (syncSessionID) {
      subagentSessions.delete(syncSessionID)
    }
  }
}

async function runLifecycleCallback(
  callback: ((sessionID: string) => Promise<void>) | undefined,
  sessionID: string,
): Promise<void> {
  if (!callback) return
  try {
    await callback(sessionID)
  } catch (error) {
    throw new LifecyclePersistenceError(error)
  }
}
