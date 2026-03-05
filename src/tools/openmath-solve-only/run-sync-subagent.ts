import type { SyncTaskDeps } from "../delegate-task/sync-task-deps"
import { syncTaskDeps } from "../delegate-task/sync-task-deps"
import type { DelegateTaskArgs, OpencodeClient, ToolContextWithMetadata } from "../delegate-task/types"
import { subagentSessions } from "../../features/claude-code-session-state"

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
  },
  deps: SyncTaskDeps = syncTaskDeps,
): Promise<{ ok: true; sessionID: string; text: string } | { ok: false; error: string; error_code?: string }> {
  let syncSessionID: string | null = null

  try {
    const createResult = await deps.createSyncSession(args.client, {
      parentSessionID: args.parentSessionID,
      agentToUse: args.agentToUse,
      description: args.description,
      defaultDirectory: args.directory,
    })

    if (!createResult.ok) {
      return { ok: false, error: createResult.error }
    }

    syncSessionID = createResult.sessionID
    subagentSessions.add(syncSessionID)

    const delegateArgs: DelegateTaskArgs = {
      description: args.description,
      prompt: args.prompt,
      run_in_background: false,
      load_skills: [],
      command: undefined,
    }

    const promptError = await deps.sendSyncPrompt(args.client, {
      sessionID: syncSessionID,
      agentToUse: args.agentToUse,
      args: delegateArgs,
      systemContent: undefined,
      categoryModel: undefined,
      toastManager: null,
      taskId: undefined,
    })

    if (promptError) {
      return { ok: false, error: promptError, ...(isAgentNotFoundError(promptError) ? { error_code: "AGENT_NOT_FOUND" } : {}) }
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
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: message }
  } finally {
    if (syncSessionID) {
      subagentSessions.delete(syncSessionID)
    }
  }
}
