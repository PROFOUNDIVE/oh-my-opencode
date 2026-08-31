import { adaptCertificationWitnessOutput } from "../adapters/witness-output-adapter"
import { buildCertificationWitnessPayload } from "../adapters/witness-payload"
import { buildCertificationWitnessResult } from "../adapters/witness-result-builder"
import type { CertificationSchedulerResult, CertificationStepDependencies } from "../application/certification-scheduler-contract"
import { progressCertificationJobAttempt } from "../scheduler"
import type { CertificationJobProgressResult } from "../scheduler"
import type { CertificationJobAttempt } from "../state/jobs"
import { recoverCompletedWitnessOutput } from "./recover-completed-witness-output"
import { buildWitnessEvidenceReceipt } from "./witness-evidence-receipt"
import type { WitnessVerificationOrchestrationInput } from "./witness-verification-types"

type RunInput = Parameters<CertificationStepDependencies["run_operation"]>[0]
type CompletedJob = Extract<CertificationJobAttempt, { readonly phase: "COMPLETED" }>
type WitnessTarget = Extract<CertificationJobAttempt["target"], { readonly kind: "WITNESS" }>
type CompletedWitnessJob = Omit<CompletedJob, "target"> & Readonly<{ readonly target: WitnessTarget }>

export async function runWitnessVerification(
  input: RunInput,
  configuration: WitnessVerificationOrchestrationInput,
): Promise<CertificationSchedulerResult> {
  const attempt = input.state.job_attempts.find((job) => input.state.active_job_ids.includes(job.job_id))
  if (attempt === undefined || input.state.active_job_ids.length !== 1) {
    return failure("VALIDATION_ERROR", "Witness runner requires exactly one active verifier job")
  }
  const target = attempt.target
  if (target.kind !== "WITNESS") return failure("ILLEGAL_TRANSITION", "Active job is not a witness verifier")
  const attack = input.state.attack_attempts.find((candidate) => candidate.attack_attempt_id === target.attack_attempt_id)
  const graph = input.state.graphs.find((candidate) => candidate.graph_sha256 === target.graph_sha256)
  if (attack?.outcome !== "COUNTEREXAMPLE_FOUND" || graph === undefined) return failure("STALE_GRAPH", "Witness runner target is stale")
  const payload = buildCertificationWitnessPayload({ graph, sources: configuration.context.sources, attack })
  const runtime = configuration.create_job_runtime?.({
    operation_owner: input.operation_owner,
    recovered_owner: input.recovered_owner,
    persist_job_attempt: input.persist_job_attempt,
    block_reconciliation: input.block_reconciliation,
  }) ?? unavailableRuntime()
  let adapted: ReturnType<typeof adaptCertificationWitnessOutput> | null = null
  let progressed: CertificationJobProgressResult
  try {
    progressed = await (configuration.progress_job ?? progressCertificationJobAttempt)({
      parent_session_id: configuration.context.parent_session_id,
      attempt,
      system_content: configuration.context.witness_role.prompt.content,
      user_prompt: JSON.stringify(payload),
      receipt_from_output: (rawOutput) => {
        adapted = adaptCertificationWitnessOutput(rawOutput, { attack, target })
        if (!adapted.ok) throw new CertificationWitnessAdapterError(adapted.error.message)
        return { kind: "WITNESS", witness_verification_id: target.witness_verification_id }
      },
      runtime,
    })
  } catch (error) {
    return block(input, "RECONCILIATION_AMBIGUOUS", error instanceof Error ? error.message : String(error))
  }
  switch (progressed.kind) {
    case "completed":
      return commitCompleted(input, runtime, attack, progressed.attempt, adapted)
    case "failed":
      return block(input, progressed.attempt.receipt.error_code === "ADAPTER_OUTPUT_INVALID"
        ? "ADAPTER_OUTPUT_INVALID" : "DISPATCH_FAILED", progressed.attempt.receipt.message)
    case "blocked":
      return { ok: true }
    case "committed":
      return { ok: true }
    case "error":
      return block(input, progressReason(progressed.error_code), progressed.message)
    default:
      return assertNever(progressed)
  }
}

async function commitCompleted(
  input: RunInput,
  runtime: Parameters<typeof recoverCompletedWitnessOutput>[1],
  attack: Extract<RunInput["state"]["attack_attempts"][number], { readonly outcome: "COUNTEREXAMPLE_FOUND" }>,
  completed: CompletedJob,
  adapted: ReturnType<typeof adaptCertificationWitnessOutput> | null,
): Promise<CertificationSchedulerResult> {
  if (completed.target.kind !== "WITNESS" || completed.receipt.kind !== "WITNESS") {
    return block(input, "ADAPTER_OUTPUT_INVALID", "Completed verifier receipt does not match its target")
  }
  let output = adapted
  if (output === null) {
    const recovered = await recoverCompletedWitnessOutput(completedWitness(completed), runtime)
    if (!recovered.ok) return block(input, "RECONCILIATION_AMBIGUOUS", recovered.message)
    output = adaptCertificationWitnessOutput(recovered.raw_output, { attack, target: completed.target })
  }
  if (!output.ok) return block(input, "ADAPTER_OUTPUT_INVALID", output.error.message)
  const witness = buildCertificationWitnessResult({
    output: output.output,
    attack,
    target: completed.target,
    certification_revision: completed.phase_revision + 1,
    job_id: completed.job_id,
  })
  const result = await input.commit_transition({
    type: "COMMIT_WITNESSES",
    completed_jobs: [completed],
    witness_verifications: [witness],
    evidence_receipts: [buildWitnessEvidenceReceipt({ state: input.state, job: completedWitness(completed), witness })],
  })
  return result.kind === "ok" ? { ok: true } : failure(result.error_code, result.message)
}

async function block(input: RunInput, reason: "ADAPTER_OUTPUT_INVALID" | "DISPATCH_FAILED" | "RECONCILIATION_AMBIGUOUS" | "STORAGE_READ_FAILED" | "STORAGE_WRITE_FAILED", message: string) {
  const result = await input.commit_transition({ type: "BLOCK", reason })
  return result.kind === "ok" ? { ok: true as const } : failure(result.error_code, `${message}: ${result.message}`)
}

function progressReason(code: string): "RECONCILIATION_AMBIGUOUS" | "STORAGE_READ_FAILED" | "STORAGE_WRITE_FAILED" {
  return code === "STORAGE_READ_FAILED" || code === "STORAGE_WRITE_FAILED" ? code : "RECONCILIATION_AMBIGUOUS"
}

function completedWitness(job: CompletedJob): CompletedWitnessJob {
  if (job.target.kind !== "WITNESS") throw new CertificationWitnessAdapterError("Expected completed witness job")
  const target = job.target
  return { ...job, target }
}

function unavailableRuntime(): Parameters<typeof progressCertificationJobAttempt>[0]["runtime"] {
  const unavailable = async () => { throw new CertificationWitnessRuntimeError() }
  return { verify_operation_owner: async () => ({ ok: true }), persist_job_attempt: unavailable,
    block_reconciliation: unavailable, list_children: unavailable, get_session: unavailable,
    list_messages: unavailable, dispatch: unavailable }
}

function failure(error_code: Extract<CertificationSchedulerResult, { readonly ok: false }>["error_code"], message: string) {
  return { ok: false as const, error_code, message }
}

class CertificationWitnessAdapterError extends Error { readonly name = "CertificationWitnessAdapterError" }
class CertificationWitnessRuntimeError extends Error { readonly name = "CertificationWitnessRuntimeError" }

function assertNever(value: never): never {
  throw new TypeError(`Unexpected witness verification progress: ${String(value)}`)
}
