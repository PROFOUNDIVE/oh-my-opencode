import {
  getResearchCampaignDirectory,
  readResearchCampaignState,
  releaseResearchCampaignOperationLock,
  type ResearchCampaignOperationLockReleaseResult,
} from "../storage"
import { reduceCampaignTransition } from "../transitions"
import type { CampaignStateResult } from "./campaign-application-result"
import type { CampaignStepDependencies } from "./campaign-scheduler-contract"
import { acquireCampaignOperation } from "./acquire-campaign-operation"
import { commitSchedulerTransition } from "./commit-scheduler-transition"
import { blockCampaignJobReconciliation, commitCampaignJobLifecycle } from "./commit-campaign-job-lifecycle"
import { staleCampaignRevision, writeCampaignTransition } from "./commit-campaign-transition"
import { stateResultEnvelope } from "./state-result-envelope"
import type { CampaignJobBlockResult, CampaignJobPersistenceResult } from "../scheduler/campaign-job-runtime-types"
import { reopenBlockedCampaignOperation } from "./reopen-blocked-campaign-operation"
import { rethrowAfterResearchCampaignLockCleanup } from "../storage/lock-cleanup-error"

type CampaignStateResultWithCleanup = CampaignStateResult | (Extract<CampaignStateResult, { readonly kind: "error" }> & {
  readonly cleanup_failure: Extract<ResearchCampaignOperationLockReleaseResult, { readonly kind: "error" }>
})

export async function runCampaignOperation(input: Readonly<{
  readonly directory: string
  readonly campaign_id: string
  readonly state_revision: number
  readonly operation_revision: number
}>, dependencies: CampaignStepDependencies): Promise<CampaignStateResultWithCleanup> {
  const campaignDirectory = getResearchCampaignDirectory(input.directory, input.campaign_id)
  const operationId = `${input.campaign_id}:operation:${input.operation_revision}`
  const acquired = await acquireCampaignOperation({
    campaign_directory: campaignDirectory,
    operation_id: operationId,
  }, dependencies)
  if (acquired.kind === "error") return acquired

  let outcome: CampaignStateResult
  try {
    outcome = await runOwnedOperation(input, acquired.recovered_owner, dependencies)
  } catch (error) {
    return rethrowAfterResearchCampaignLockCleanup(error, () =>
      (dependencies.release_lock ?? releaseResearchCampaignOperationLock)({
        campaign_directory: campaignDirectory,
        token: acquired.owner.token,
      }))
  }
  const released = await (dependencies.release_lock ?? releaseResearchCampaignOperationLock)({
    campaign_directory: campaignDirectory,
    token: acquired.owner.token,
  })
  if (released.kind === "error" && outcome.kind === "error") {
    return { ...outcome, cleanup_failure: released }
  }
  return released.kind === "error" ? released : outcome
}

async function runOwnedOperation(
  input: Readonly<{ readonly directory: string; readonly campaign_id: string; readonly state_revision: number }>,
  recoveredOwner: Parameters<CampaignStepDependencies["run_operation"]>[0]["recovered_owner"],
  dependencies: CampaignStepDependencies,
): Promise<CampaignStateResult> {
  const current = await (dependencies.read_state ?? readResearchCampaignState)(input.directory, input.campaign_id)
  if (current.kind === "error") return current
  if (current.state.state_revision !== input.state_revision) {
    return staleCampaignRevision(input.state_revision, current.state.state_revision)
  }
  const preflight = reduceCampaignTransition(current.state, { type: "REQUEST_STEP", mode: "one_stage" })
  if (!preflight.ok) return { kind: "error", error_code: preflight.error_code, message: preflight.message }

  let running = current.state
  if (preflight.directive === "reconcile" && current.state.status === "BLOCKED") {
    const reopened = reopenBlockedCampaignOperation(current.state)
    if (!reopened.ok) return { kind: "error", error_code: "RECONCILIATION_BLOCKED", message: reopened.message }
    const written = await writeCampaignTransition({
      directory: input.directory,
      campaign_id: input.campaign_id,
      expected_state_revision: current.state.state_revision,
    }, reopened.state, dependencies)
    if (written.kind === "error") return written
    running = written.state
  }
  if (preflight.directive === "execute") {
    const planned = dependencies.plan_operation(current.state)
    if (!planned.ok) return { kind: "error", error_code: planned.error_code, message: planned.message }
    const admission = reduceCampaignTransition(current.state, {
      type: "ADMIT_OPERATION",
      job_attempts: planned.plan.job_attempts,
      candidates: planned.plan.candidates,
    })
    if (!admission.ok) return { kind: "error", error_code: admission.error_code, message: admission.message }
    const written = await writeCampaignTransition({
      directory: input.directory,
      campaign_id: input.campaign_id,
      expected_state_revision: current.state.state_revision,
    }, admission.state, dependencies)
    if (written.kind === "error") return written
    running = written.state
  }

  let callbackTail = Promise.resolve<CampaignStateResult>({ kind: "ok", state: running })
  const persistJobAttempt: Parameters<CampaignStepDependencies["run_operation"]>[0]["persist_job_attempt"] = async (update) => {
    const execution = callbackTail.then(async (previous): Promise<Readonly<{
      readonly state_result: CampaignStateResult
      readonly job_result: CampaignJobPersistenceResult
    }>> => {
      if (previous.kind === "error") return { state_result: previous, job_result: callbackFailure(previous) }
      const result = await commitCampaignJobLifecycle({
        directory: input.directory,
        campaign_id: input.campaign_id,
        update,
      }, dependencies)
      return result.ok && result.state !== undefined
        ? { state_result: { kind: "ok", state: result.state }, job_result: result }
        : { state_result: result.ok ? previous : campaignStateFailure(result), job_result: result }
    })
    callbackTail = execution.then((result) => result.state_result)
    return await execution.then((result) => result.job_result)
  }
  const blockReconciliation: Parameters<CampaignStepDependencies["run_operation"]>[0]["block_reconciliation"] = async (request) => {
    const execution = callbackTail.then(async (previous): Promise<Readonly<{
      readonly state_result: CampaignStateResult
      readonly block_result: CampaignJobBlockResult
    }>> => {
      if (previous.kind === "error") return { state_result: previous, block_result: callbackFailure(previous) }
      const result = await blockCampaignJobReconciliation({
        directory: input.directory,
        campaign_id: input.campaign_id,
        ...request,
      }, dependencies)
      return result.ok && result.state !== undefined
        ? { state_result: { kind: "ok", state: result.state }, block_result: result }
        : { state_result: result.ok ? previous : campaignStateFailure(result), block_result: result }
    })
    callbackTail = execution.then((result) => result.state_result)
    return await execution.then((result) => result.block_result)
  }
  const commitTransition: Parameters<CampaignStepDependencies["run_operation"]>[0]["commit_transition"] = (event) => {
    callbackTail = callbackTail.then((previous) => previous.kind === "error"
      ? previous
      : commitSchedulerTransition({ directory: input.directory, campaign_id: input.campaign_id, event }, dependencies))
    return callbackTail.then(stateResultEnvelope)
  }
  const scheduler = await dependencies.run_operation({
    state: running,
    recovered_owner: recoveredOwner,
    persist_job_attempt: persistJobAttempt,
    block_reconciliation: blockReconciliation,
    commit_transition: commitTransition,
  })
  const callbackResult = await callbackTail
  if (callbackResult.kind === "error") return callbackResult
  return scheduler.ok
    ? callbackResult
    : { kind: "error", error_code: scheduler.error_code, message: scheduler.message }
}

function callbackFailure(result: Extract<CampaignStateResult, { readonly kind: "error" }>): Extract<CampaignJobPersistenceResult, { readonly ok: false }> {
  return { ok: false, error_code: result.error_code, message: result.message }
}

function campaignStateFailure(result: Extract<CampaignJobPersistenceResult, { readonly ok: false }>): CampaignStateResult {
  return { kind: "error", error_code: result.error_code, message: result.message }
}
