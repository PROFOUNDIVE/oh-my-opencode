import type { OpencodeClient, ToolContextWithMetadata } from "../../../../tools/delegate-task/types"
import { runSyncSubagentText } from "../../../../tools/openmath-solve-only/run-sync-subagent"
import { createSyncStageDispatch } from "../../../workflow/stage-runner/sync-stage-dispatch"
import type { CertificationJobRuntime } from "./certification-job-runtime-types"
import {
  verifyCertificationOperationOwner,
  type CertificationOperationOwner,
} from "./verify-certification-operation-owner"

type CertificationDispatchRuntimeDependencies = Readonly<{
  readonly run_subagent: typeof runSyncSubagentText
  readonly verify_operation_owner: typeof verifyCertificationOperationOwner
}>

const defaultDependencies: CertificationDispatchRuntimeDependencies = {
  run_subagent: runSyncSubagentText,
  verify_operation_owner: verifyCertificationOperationOwner,
}

export function createCertificationDispatchRuntime(input: Readonly<{
  readonly client: OpencodeClient
  readonly directory: string
  readonly ctx: ToolContextWithMetadata
  readonly campaign_id: string
  readonly operation_owner: CertificationOperationOwner
  readonly persist_job_attempt: CertificationJobRuntime["persist_job_attempt"]
  readonly block_reconciliation: CertificationJobRuntime["block_reconciliation"]
}>, dependencies: CertificationDispatchRuntimeDependencies = defaultDependencies): CertificationJobRuntime {
  const dispatch = createSyncStageDispatch({
    client: input.client,
    directory: input.directory,
    ctx: input.ctx,
  }, { runSubagent: dependencies.run_subagent })
  return {
    verify_operation_owner: () => dependencies.verify_operation_owner({
      directory: input.directory,
      campaign_id: input.campaign_id,
      owner: input.operation_owner,
    }),
    persist_job_attempt: input.persist_job_attempt,
    block_reconciliation: input.block_reconciliation,
    list_children: async (parentSessionID) => {
      const result = await input.client.session.children({
        path: { id: parentSessionID },
        query: { directory: input.directory },
      })
      if (result.error) throw new CertificationSessionInspectionError("Unable to list certification child sessions", result.error)
      return result.data.map((child) => ({ id: child.id }))
    },
    get_session: async (sessionID) => {
      const result = await input.client.session.get({
        path: { id: sessionID },
        query: { directory: input.directory },
      })
      if (result.error) throw new CertificationSessionInspectionError("Unable to inspect certification child session", result.error)
      return { title: result.data.title }
    },
    list_messages: async (sessionID) => {
      const result = await input.client.session.messages({
        path: { id: sessionID },
        query: { directory: input.directory },
      })
      if (result.error) throw new CertificationSessionInspectionError("Unable to inspect certification child transcript", result.error)
      return result.data.map((message) => ({
        role: message.info.role,
        text: message.parts.filter((part) => part.type === "text").map((part) => part.text).join(""),
      }))
    },
    dispatch: async (request) => {
      const ownership = await dependencies.verify_operation_owner({
        directory: input.directory,
        campaign_id: input.campaign_id,
        owner: input.operation_owner,
      })
      return ownership.ok
        ? dispatch({ ...request, tool_policy: "deny_all" })
        : { ok: false, error: ownership.message }
    },
  }
}

class CertificationSessionInspectionError extends Error {
  readonly name = "CertificationSessionInspectionError"

  constructor(message: string, readonly detail: unknown) {
    super(`${message}: ${String(detail)}`)
  }
}
