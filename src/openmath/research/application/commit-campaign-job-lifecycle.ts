import { ResearchCampaignStateV1Schema, type CampaignJobAttempt, type ResearchCampaignStateV1 } from "../state"
import { compareAndSwapResearchCampaignState, readResearchCampaignState } from "../storage"
import { advanceCampaignJob } from "../scheduler/advance-campaign-job"
import type {
  CampaignJobBlockResult,
  CampaignJobLifecycleUpdate,
  CampaignJobPersistenceResult,
} from "../scheduler/campaign-job-runtime-types"
import type { CampaignMutationDependencies } from "./campaign-mutation-dependencies"

type PersistedJobResult =
  | { readonly ok: true; readonly attempt: CampaignJobAttempt; readonly state: ResearchCampaignStateV1 }
  | Extract<CampaignJobPersistenceResult, { readonly ok: false }>

type PersistedBlockResult =
  | { readonly ok: true; readonly state: ResearchCampaignStateV1 }
  | Extract<CampaignJobBlockResult, { readonly ok: false }>

export async function commitCampaignJobLifecycle(input: Readonly<{
  readonly directory: string
  readonly campaign_id: string
  readonly update: CampaignJobLifecycleUpdate
}>, dependencies: CampaignMutationDependencies = {}): Promise<PersistedJobResult> {
  const current = await (dependencies.read_state ?? readResearchCampaignState)(input.directory, input.campaign_id)
  if (current.kind === "error") return storageFailure(current)
  if (current.state.status !== "RUNNING" || !current.state.active_job_ids.includes(input.update.job_id)) {
    return blocked("Lifecycle receipt does not belong to the active campaign operation")
  }
  const attempt = current.state.job_attempts.find((job) => job.job_id === input.update.job_id)
  if (attempt === undefined) return blocked("Lifecycle receipt job was not found")
  const advanced = advanceCampaignJob(attempt, input.update, current.state.state_revision + 1)
  if (!advanced.ok) return blocked(advanced.message)
  const nextState = ResearchCampaignStateV1Schema.parse({
    ...current.state,
    state_revision: current.state.state_revision + 1,
    job_attempts: replaceAttempt(current.state.job_attempts, advanced.attempt),
  })
  const persisted = await (dependencies.compare_and_swap ?? compareAndSwapResearchCampaignState)({
    directory: input.directory,
    campaign_id: input.campaign_id,
    expected_state_revision: current.state.state_revision,
    next_state: nextState,
  })
  return persisted.kind === "error"
    ? storageFailure(persisted)
    : { ok: true, attempt: advanced.attempt, state: persisted.state }
}

export async function blockCampaignJobReconciliation(input: Readonly<{
  readonly directory: string
  readonly campaign_id: string
  readonly job_id: CampaignJobAttempt["job_id"]
  readonly message: string
}>, dependencies: CampaignMutationDependencies = {}): Promise<PersistedBlockResult> {
  const current = await (dependencies.read_state ?? readResearchCampaignState)(input.directory, input.campaign_id)
  if (current.kind === "error") return storageFailure(current)
  if (current.state.status !== "RUNNING" || !current.state.active_job_ids.includes(input.job_id)) {
    return blocked("Reconciliation block does not belong to the active campaign operation")
  }
  const nextState = ResearchCampaignStateV1Schema.parse({
    ...current.state,
    state_revision: current.state.state_revision + 1,
    status: "BLOCKED",
    blocked_reason: input.message,
    active_job_ids: [],
  })
  const persisted = await (dependencies.compare_and_swap ?? compareAndSwapResearchCampaignState)({
    directory: input.directory,
    campaign_id: input.campaign_id,
    expected_state_revision: current.state.state_revision,
    next_state: nextState,
  })
  return persisted.kind === "error" ? storageFailure(persisted) : { ok: true, state: persisted.state }
}

function replaceAttempt(attempts: readonly CampaignJobAttempt[], replacement: CampaignJobAttempt): readonly CampaignJobAttempt[] {
  return attempts.map((attempt) => attempt.job_id === replacement.job_id ? replacement : attempt)
}

function blocked(message: string): Extract<CampaignJobPersistenceResult, { readonly ok: false }> {
  return { ok: false, error_code: "RECONCILIATION_BLOCKED", message }
}

function storageFailure(input: Readonly<{ readonly error_code: Extract<CampaignJobPersistenceResult, { readonly ok: false }>["error_code"]; readonly message: string }>): Extract<CampaignJobPersistenceResult, { readonly ok: false }> {
  return { ok: false, error_code: input.error_code, message: input.message }
}
