import type { AgentOverrides, OpenMathConfig } from "../../config/schema"
import type { OpencodeClient, ToolContextWithMetadata } from "../delegate-task/types"
import type { WorkflowStateV1 } from "../../openmath/workflow/state"
import type { StageRunnerRuntime } from "../../openmath/workflow/stage-runner"

export type OpenMathWorkflowToolOptions = Readonly<{
  readonly directory: string
  readonly client?: OpencodeClient
  readonly openmathConfig: OpenMathConfig
  readonly pluginAgents?: AgentOverrides
  readonly createStageRuntime?: (input: Readonly<{
    readonly state: WorkflowStateV1
    readonly ctx: ToolContextWithMetadata
  }>) => StageRunnerRuntime
}>
