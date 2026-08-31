import {
  blockCertificationJobOperation,
  persistCertificationJobLifecycle,
  type CertificationJobBlockResult,
  type CertificationJobLifecycleUpdate,
  type CertificationJobPersistenceResult,
  type CertificationReconciliationFailure,
} from "../scheduler"
import {
  acquireCertificationOperationLock,
  compareAndSwapCertificationGeneration,
  releaseCertificationOperationLock,
} from "../storage"
import { reduceCertificationTransition } from "../transitions"
import type { CertificationJobAttempt } from "../state/jobs"
import type { ResearchCertificationStateV1 } from "../state/schema"
import type { CertificationStepDependencies } from "./certification-scheduler-contract"
import type { CertificationApplicationFailure, CertificationContext, CertificationStateResult } from "./certification-application-types"
import { commitCertificationTransition } from "./commit-certification-transition"
import { readResearchCertification } from "./read-research-certification"

export async function runCertificationOperation(input: Readonly<{
  readonly directory: string
  readonly context: CertificationContext
  readonly state: ResearchCertificationStateV1
}>, dependencies: CertificationStepDependencies): Promise<CertificationStateResult> {
  const operationRevision = input.state.status === "RUNNING"
    ? input.state.job_attempts.find((job) => job.phase !== "COMMITTED")?.prepared_at_revision ?? input.state.certification_revision
    : input.state.certification_revision + 1
  const operationId = `${input.state.certification_id}:operation:${operationRevision}`
  const acquired = await (dependencies.acquire_operation_lock ?? acquireCertificationOperationLock)({
    directory: input.directory,
    campaign_id: input.context.campaign.campaign_id,
    operation_id: operationId,
  })
  if (acquired.kind === "error") return acquired
  let outcome: CertificationStateResult
  try {
    outcome = await runOwnedOperation(input, acquired.owner, acquired.recovered_owner, dependencies)
  } catch (error) {
    await (dependencies.release_operation_lock ?? releaseCertificationOperationLock)({
      directory: input.directory,
      campaign_id: input.context.campaign.campaign_id,
      token: acquired.owner.token,
    })
    throw error
  }
  const released = await (dependencies.release_operation_lock ?? releaseCertificationOperationLock)({
    directory: input.directory,
    campaign_id: input.context.campaign.campaign_id,
    token: acquired.owner.token,
  })
  return released.kind === "error" ? released : outcome
}

async function runOwnedOperation(
  input: Parameters<typeof runCertificationOperation>[0],
  owner: Parameters<CertificationStepDependencies["run_operation"]>[0]["operation_owner"],
  recoveredOwner: Parameters<CertificationStepDependencies["run_operation"]>[0]["recovered_owner"],
  dependencies: CertificationStepDependencies,
): Promise<CertificationStateResult> {
  const reread = await readResearchCertification({ directory: input.directory, campaign_id: input.context.campaign.campaign_id }, dependencies)
  if (reread.kind === "disabled") return failure("CAMPAIGN_NOT_ELIGIBLE", "Certification is not enabled")
  if (reread.kind === "error") return reread
  if (reread.context.campaign.state_revision !== input.context.campaign.state_revision) {
    return failure("STALE_STATE_REVISION", "Campaign changed before certification operation")
  }
  if (reread.read.kind === "not_started") return failure("CERTIFICATION_NOT_FOUND", "Certification is not initialized")
  let running = reread.read.state
  if (running.status !== "RUNNING") {
    const planned = dependencies.plan_operation(running)
    if (!planned.ok) return plannedFailure(planned)
    const prepared = reduceCertificationTransition(running, {
      type: "PREPARE_OPERATION",
      job_attempts: planned.job_attempts,
      consume_amendment_ids: planned.consume_amendment_ids,
    }, running.certification_revision)
    if (!prepared.ok) return failure(prepared.error_code, prepared.message)
    const persisted = await (dependencies.compare_and_swap_generation ?? compareAndSwapCertificationGeneration)({
      directory: input.directory,
      identity: reread.context.storage_identity,
      expected_certification_revision: running.certification_revision,
      next_state: prepared.state,
      campaign_guard: {
        expected_state_revision: input.context.campaign.state_revision,
        expected_status: "READY",
      },
    })
    if (persisted.kind === "error") return persisted
    running = persisted.state
  }
  let callbackTail = Promise.resolve<CertificationStateResult>({ kind: "ok", state: running })
  const persistJobAttempt = (update: CertificationJobLifecycleUpdate): Promise<CertificationJobPersistenceResult> => {
    const execution = callbackTail.then(async (previous) => {
      if (previous.kind === "error") return { state: previous, result: jobFailure(previous) }
      const live = await verifyCampaignStillLive(input, dependencies)
      if (live.kind === "error") return { state: live, result: jobFailure(live) }
      const result = await (dependencies.persist_job_lifecycle ?? persistCertificationJobLifecycle)({
        directory: input.directory,
        identity: reread.context.storage_identity,
        update,
        campaign_guard: {
          expected_state_revision: input.context.campaign.state_revision,
          expected_status: "READY",
        },
      })
      return { state: result.ok ? { kind: "ok" as const, state: result.state } : failure(result.error_code, result.message), result }
    })
    callbackTail = execution.then((value) => value.state)
    return execution.then((value) => value.result)
  }
  const blockReconciliation = (request: Readonly<{
    readonly job_id: CertificationJobAttempt["job_id"]
    readonly evidence: CertificationReconciliationFailure
  }>): Promise<CertificationJobBlockResult> => {
    const execution = callbackTail.then(async (previous) => {
      if (previous.kind === "error") return { state: previous, result: blockFailure(previous) }
      const live = await verifyCampaignStillLive(input, dependencies)
      if (live.kind === "error") return { state: live, result: blockFailure(live) }
      const result = await (dependencies.block_job_operation ?? blockCertificationJobOperation)({
        directory: input.directory,
        identity: reread.context.storage_identity,
        ...request,
        campaign_guard: {
          expected_state_revision: input.context.campaign.state_revision,
          expected_status: "READY",
        },
      })
      return { state: result.ok ? { kind: "ok" as const, state: result.state } : failure(result.error_code, result.message), result }
    })
    callbackTail = execution.then((value) => value.state)
    return execution.then((value) => value.result)
  }
  const commitTransition: Parameters<CertificationStepDependencies["run_operation"]>[0]["commit_transition"] = (event) => {
    callbackTail = callbackTail.then((previous) => previous.kind === "error" ? previous : commitCertificationTransition({
      directory: input.directory,
      campaign_id: input.context.campaign.campaign_id,
      expected_state_revision: input.context.campaign.state_revision,
      event,
    }, dependencies))
    return callbackTail
  }
  const scheduler = await dependencies.run_operation({
    state: running,
    operation_owner: owner,
    recovered_owner: recoveredOwner,
    persist_job_attempt: persistJobAttempt,
    block_reconciliation: blockReconciliation,
    commit_transition: commitTransition,
  })
  const callbackResult = await callbackTail
  return callbackResult.kind === "error" || scheduler.ok
    ? callbackResult
    : failure(scheduler.error_code, scheduler.message)
}

async function verifyCampaignStillLive(
  input: Parameters<typeof runCertificationOperation>[0],
  dependencies: CertificationStepDependencies,
): Promise<CertificationStateResult> {
  const read = await readResearchCertification({ directory: input.directory, campaign_id: input.context.campaign.campaign_id }, dependencies)
  if (read.kind === "disabled") return failure("CAMPAIGN_NOT_ELIGIBLE", "Certification is not enabled")
  if (read.kind === "error") return read
  if (read.context.campaign.state_revision !== input.context.campaign.state_revision) {
    return failure("STALE_STATE_REVISION", "Campaign changed during certification operation")
  }
  return read.read.kind === "ok"
    ? { kind: "ok", state: read.read.state }
    : failure("CERTIFICATION_NOT_FOUND", "Certification is not initialized")
}

function jobFailure(error: CertificationApplicationFailure): Extract<CertificationJobPersistenceResult, { readonly ok: false }> {
  return { ok: false, error_code: storageError(error.error_code), message: error.message }
}

function blockFailure(error: CertificationApplicationFailure): Extract<CertificationJobBlockResult, { readonly ok: false }> {
  return { ok: false, error_code: storageError(error.error_code), message: error.message }
}

function storageError(code: CertificationApplicationFailure["error_code"]): Extract<CertificationJobPersistenceResult, { readonly ok: false }>["error_code"] {
  switch (code) {
    case "STALE_CERTIFICATION_REVISION":
    case "STORAGE_ATOMICITY_UNAVAILABLE":
    case "STORAGE_BUSY":
    case "STORAGE_READ_FAILED":
    case "STORAGE_WRITE_FAILED":
      return code
    default:
      return "RECONCILIATION_AMBIGUOUS"
  }
}

function plannedFailure(result: Extract<ReturnType<CertificationStepDependencies["plan_operation"]>, { readonly ok: false }>): CertificationApplicationFailure {
  return failure(result.error_code, result.message)
}

function failure(errorCode: CertificationApplicationFailure["error_code"], message: string): CertificationApplicationFailure {
  return { kind: "error", error_code: errorCode, message }
}
