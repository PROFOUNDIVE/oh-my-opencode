import type { WorkflowStateV1 } from "../state"
import type { WorkflowErrorCode } from "../state/literals"

export type StageSubagentDispatch = Readonly<{
  readonly parent_session_id: string
  readonly child_title: string
  readonly agent_to_use: string
  readonly category_model: Readonly<{ readonly providerID: string; readonly modelID: string; readonly variant?: string }>
  readonly system_content: string | undefined
  readonly user_prompt: string
  readonly prompt_marker: string
  readonly persisted_session_id: string | undefined
  readonly send_prompt: boolean
  readonly awaited_callbacks: Readonly<{
    readonly on_session_created?: (sessionID: string) => Promise<void>
    readonly on_prompt_sent?: (sessionID: string) => Promise<void>
  }>
}>

export type StageRunnerRuntime = Readonly<{
  readonly persist: (nextState: WorkflowStateV1) => Promise<WorkflowStateV1>
  readonly list_children: (parentSessionID: string) => Promise<readonly Readonly<{ readonly id: string }>[]>
  readonly get_session: (sessionID: string) => Promise<Readonly<{ readonly title: string }>>
  readonly list_messages: (sessionID: string) => Promise<readonly Readonly<{ readonly role: string; readonly text: string }>[]>
  readonly dispatch: (input: StageSubagentDispatch) => Promise<
    | Readonly<{ readonly ok: true; readonly session_id: string; readonly text: string }>
    | Readonly<{
        readonly ok: false
        readonly error: string
        readonly error_code?: Exclude<WorkflowErrorCode, "ADAPTER_OUTPUT_INVALID">
        readonly legacy_failure?: "SOLVER_PATCH_FAILED"
      }>
  >
}>
