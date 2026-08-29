import type { WorkflowStateV1 } from "../state"
import type { WorkflowMutationResult } from "../storage"
import { startWorkflowFromSnapshots } from "./start-workflow-from-snapshots"

type ResolvedWorkflowRequest = Readonly<{
  readonly snapshot: NonNullable<WorkflowStateV1["request_snapshot"]>
  readonly initial_artifact: NonNullable<WorkflowStateV1["artifact"]> | undefined
}>

type StartWorkflowInput = Readonly<{
  readonly run_id: string
  readonly parent_session_id: string
}>

type StartWorkflowDependencies = Readonly<{
  readonly directory: string
  readonly resolve_request: () => Promise<ResolvedWorkflowRequest>
  readonly resolve_profile: () => Promise<WorkflowStateV1["profile_snapshot"]>
  readonly resolve_references: () => WorkflowStateV1["reference_snapshot"] | Promise<WorkflowStateV1["reference_snapshot"]>
  readonly start_state: (input: Readonly<{ readonly directory: string; readonly state: WorkflowStateV1 }>) => Promise<WorkflowMutationResult>
}>

export async function startWorkflowFromCurrentSources(
  input: StartWorkflowInput,
  dependencies: StartWorkflowDependencies,
): Promise<WorkflowMutationResult> {
  const request = await dependencies.resolve_request()
  const profile = await dependencies.resolve_profile()
  const references = await dependencies.resolve_references()
  return startWorkflowFromSnapshots({
    directory: dependencies.directory,
    run_id: input.run_id,
    parent_session_id: input.parent_session_id,
    request_snapshot: request.snapshot,
    profile_snapshot: profile,
    reference_snapshot: references,
    artifact: request.initial_artifact,
  }, { start_state: dependencies.start_state })
}
