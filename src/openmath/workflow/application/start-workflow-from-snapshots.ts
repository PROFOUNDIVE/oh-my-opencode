import type { WorkflowStateV1 } from "../state"
import type { WorkflowMutationResult } from "../storage"
import { createInitialWorkflowState } from "../transitions"

type StartWorkflowFromSnapshotsInput = Readonly<{
  readonly directory: string
  readonly run_id: string
  readonly parent_session_id: string
  readonly request_snapshot: NonNullable<WorkflowStateV1["request_snapshot"]>
  readonly profile_snapshot: WorkflowStateV1["profile_snapshot"]
  readonly reference_snapshot: WorkflowStateV1["reference_snapshot"]
  readonly artifact: NonNullable<WorkflowStateV1["artifact"]> | undefined
}>

type StartWorkflowFromSnapshotsDependencies = Readonly<{
  readonly start_state: (input: Readonly<{ readonly directory: string; readonly state: WorkflowStateV1 }>) => Promise<WorkflowMutationResult>
}>

export async function startWorkflowFromSnapshots(
  input: StartWorkflowFromSnapshotsInput,
  dependencies: StartWorkflowFromSnapshotsDependencies,
): Promise<WorkflowMutationResult> {
  const state = createInitialWorkflowState({
    run_id: input.run_id,
    parent_session_id: input.parent_session_id,
    request_snapshot: input.request_snapshot,
    profile_snapshot: input.profile_snapshot,
    reference_snapshot: input.reference_snapshot,
    ...(input.artifact === undefined ? {} : { artifact: input.artifact }),
  })
  return dependencies.start_state({ directory: input.directory, state })
}
