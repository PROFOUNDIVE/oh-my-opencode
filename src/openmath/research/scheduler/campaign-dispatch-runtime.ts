import type { OpencodeClient, ToolContextWithMetadata } from "../../../tools/delegate-task/types"
import { runSyncSubagentText } from "../../../tools/openmath-solve-only/run-sync-subagent"
import { createSyncStageDispatch } from "../../workflow/stage-runner/sync-stage-dispatch"
import type { CampaignJobRuntime } from "./campaign-job-runtime-types"

type CampaignDispatchRuntimeDependencies = Readonly<{
  readonly run_subagent: typeof runSyncSubagentText
}>

const defaultDependencies: CampaignDispatchRuntimeDependencies = {
  run_subagent: runSyncSubagentText,
}

export function createCampaignDispatchRuntime(input: Readonly<{
  readonly client: OpencodeClient
  readonly directory: string
  readonly ctx: ToolContextWithMetadata
  readonly persist_job_attempt: CampaignJobRuntime["persist_job_attempt"]
  readonly block_reconciliation: CampaignJobRuntime["block_reconciliation"]
}>, dependencies: CampaignDispatchRuntimeDependencies = defaultDependencies): CampaignJobRuntime {
  const dispatch = createSyncStageDispatch({
    client: input.client,
    directory: input.directory,
    ctx: input.ctx,
  }, { runSubagent: dependencies.run_subagent })
  return {
    persist_job_attempt: input.persist_job_attempt,
    block_reconciliation: input.block_reconciliation,
    list_children: async (parentSessionID) => {
      const result = await input.client.session.children({
        path: { id: parentSessionID },
        query: { directory: input.directory },
      })
      if (result.error) throw new CampaignSessionInspectionError("Unable to list campaign child sessions", result.error)
      return result.data.map((child) => ({ id: child.id }))
    },
    get_session: async (sessionID) => {
      const result = await input.client.session.get({
        path: { id: sessionID },
        query: { directory: input.directory },
      })
      if (result.error) throw new CampaignSessionInspectionError("Unable to inspect campaign child session", result.error)
      return { title: result.data.title }
    },
    list_messages: async (sessionID) => {
      const result = await input.client.session.messages({
        path: { id: sessionID },
        query: { directory: input.directory },
      })
      if (result.error) throw new CampaignSessionInspectionError("Unable to inspect campaign child transcript", result.error)
      return result.data.map((message) => ({
        role: message.info.role,
        text: message.parts.filter((part) => part.type === "text").map((part) => part.text).join(""),
      }))
    },
    dispatch: async (request) => dispatch({ ...request, tool_policy: "deny_all" }),
  }
}

class CampaignSessionInspectionError extends Error {
  readonly name = "CampaignSessionInspectionError"
  constructor(message: string, readonly detail: unknown) {
    super(`${message}: ${String(detail)}`)
  }
}
