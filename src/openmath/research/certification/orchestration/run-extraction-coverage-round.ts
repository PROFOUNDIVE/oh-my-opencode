import { adaptCoverageOutput } from "../adapters/coverage-output-adapter"
import { buildCoverageReview } from "../adapters/coverage-review-builder"
import { adaptExtractionOutput } from "../adapters/extraction-output-adapter"
import type { CertificationSchedulerResult, CertificationStepDependencies } from "../application/certification-scheduler-contract"
import { progressCertificationJobAttempt } from "../scheduler"
import type { CertificationJobAttempt } from "../state/jobs"
import type { EvidenceReceiptV1 } from "../state/evidence"
import { EvidenceReceiptV1Schema } from "../state/evidence"
import { buildCoverageRoundPayload, buildExtractionRoundPayload } from "./extraction-coverage-payload"
import type { ExtractionCoverageOrchestrationInput } from "./extraction-coverage-types"
import { recoverCompletedRoundOutput } from "./recover-completed-round-output"

type RunInput = Parameters<CertificationStepDependencies["run_operation"]>[0]
type CompletedJob = Extract<CertificationJobAttempt, { readonly phase: "COMPLETED" }>

export async function runExtractionCoverageRound(
  input: RunInput,
  configuration: ExtractionCoverageOrchestrationInput,
): Promise<CertificationSchedulerResult> {
  const attempt = input.state.job_attempts.find((job) => input.state.active_job_ids.includes(job.job_id))
  if (attempt === undefined || input.state.active_job_ids.length !== 1) return failure("VALIDATION_ERROR", "Round requires exactly one active job")
  if (attempt.target.kind !== "EXTRACTION" && attempt.target.kind !== "COVERAGE") {
    return failure("ILLEGAL_TRANSITION", "Round runner cannot schedule attacks or witnesses")
  }
  const runtime = configuration.create_job_runtime?.({
    operation_owner: input.operation_owner,
    recovered_owner: input.recovered_owner,
    persist_job_attempt: input.persist_job_attempt,
    block_reconciliation: input.block_reconciliation,
  }) ?? unavailableRuntime()
  let extracted: ReturnType<typeof adaptExtractionOutput> | null = null
  let covered: ReturnType<typeof adaptCoverageOutput> | null = null
  const payload = attempt.target.kind === "EXTRACTION"
    ? buildExtractionRoundPayload(input.state, configuration.context)
    : buildCoverageRoundPayload(input.state, configuration.context)
  let progressed: Awaited<ReturnType<typeof progressCertificationJobAttempt>>
  try {
    progressed = await (configuration.progress_job ?? progressCertificationJobAttempt)({
      parent_session_id: configuration.context.parent_session_id,
      attempt,
      system_content: attempt.target.kind === "EXTRACTION"
        ? configuration.context.extraction_role.prompt.content
        : configuration.context.coverage_role.prompt.content,
      user_prompt: JSON.stringify(payload),
      receipt_from_output: (rawOutput) => {
        if (attempt.target.kind === "EXTRACTION") {
          extracted = adaptExtractionOutput(rawOutput, {
            sources: configuration.context.sources,
            max_obligations: configuration.context.profile.max_obligations,
          })
          if (!extracted.ok) throw new CertificationRoundAdapterError(extracted.error.message)
          return { kind: "EXTRACTION", graph_sha256: extracted.graph.graph_sha256 }
        }
        if (attempt.target.kind !== "COVERAGE") throw new CertificationRoundAdapterError("Coverage target changed during dispatch")
        const coverageInput = buildCoverageRoundPayload(input.state, configuration.context)
        covered = adaptCoverageOutput(rawOutput, { input: coverageInput, sources: configuration.context.sources })
        if (!covered.ok) throw new CertificationRoundAdapterError(covered.error.message)
        return { kind: "COVERAGE", coverage_review_id: attempt.target.coverage_review_id }
      },
      runtime,
    })
  } catch (error) {
    return blockReason(input, "RECONCILIATION_AMBIGUOUS", error instanceof Error ? error.message : String(error))
  }
  switch (progressed.kind) {
    case "completed": {
      if (extracted === null && covered === null) {
        const recovered = await recoverCompletedRoundOutput(progressed.attempt, runtime)
        if (!recovered.ok) return blockReason(input, "RECONCILIATION_AMBIGUOUS", recovered.message)
        if (progressed.attempt.target.kind === "EXTRACTION") {
          extracted = adaptExtractionOutput(recovered.raw_output, {
            sources: configuration.context.sources,
            max_obligations: configuration.context.profile.max_obligations,
          })
        } else if (progressed.attempt.target.kind === "COVERAGE") {
          covered = adaptCoverageOutput(recovered.raw_output, {
            input: buildCoverageRoundPayload(input.state, configuration.context),
            sources: configuration.context.sources,
          })
        }
      }
      return commitCompleted(input, configuration, progressed.attempt, extracted, covered)
    }
    case "failed":
      return blockFailed(input, progressed.attempt)
    case "blocked":
    case "committed":
      return { ok: true }
    case "error":
      return blockProgressError(input, progressed.error_code, progressed.message)
    default:
      return assertNever(progressed)
  }
}

async function commitCompleted(
  input: RunInput,
  configuration: ExtractionCoverageOrchestrationInput,
  completed: CompletedJob,
  extracted: ReturnType<typeof adaptExtractionOutput> | null,
  covered: ReturnType<typeof adaptCoverageOutput> | null,
): Promise<CertificationSchedulerResult> {
  const revision = completed.phase_revision + 1
  if (completed.target.kind === "EXTRACTION") {
    if (extracted === null || !extracted.ok) return block(input, "ADAPTER_OUTPUT_INVALID")
    const result = await input.commit_transition({
      type: "COMMIT_EXTRACTION",
      completed_jobs: [completed],
      graph: extracted.graph,
      evidence_receipts: [evidence(input, completed, extracted.graph.graph_sha256, extracted.graph.graph_sha256, revision)],
    })
    return stateResult(result)
  }
  if (completed.target.kind !== "COVERAGE") return block(input, "ADAPTER_OUTPUT_INVALID")
  if (covered === null || !covered.ok) return block(input, "ADAPTER_OUTPUT_INVALID")
  const coverageInput = buildCoverageRoundPayload(input.state, configuration.context)
  const built = buildCoverageReview({
    output: covered.output,
    input: coverageInput,
    sources: configuration.context.sources,
    coverage_review_id: completed.target.coverage_review_id,
    certification_revision: revision,
    job_id: completed.job_id,
    coverage_round: completed.target.coverage_round,
  })
  const result = await input.commit_transition({
    type: "COMMIT_COVERAGE",
    completed_jobs: [completed],
    coverage: built.coverage,
    evidence_receipts: [evidence(input, completed, completed.target.coverage_review_id, completed.target.graph_sha256, revision)],
    profile: configuration.context.profile,
  })
  return stateResult(result)
}

function evidence(input: RunInput, job: CompletedJob, resultId: string, graphSha256: string, revision: number): EvidenceReceiptV1 {
  return EvidenceReceiptV1Schema.parse({
    schema_version: 1,
    evidence_id: `evidence-${String(input.state.evidence_receipts.length + 1).padStart(4, "0")}`,
    evidence_type: "LLM_REVIEW",
    certification_id: input.state.certification_id,
    generation_id: input.state.generation_id,
    campaign_id: input.state.campaign_id,
    certification_revision: revision,
    job_id: job.job_id,
    job_kind: job.job_kind,
    artifact_sha256: input.state.selected_artifact.artifact_sha256,
    graph_sha256: graphSha256,
    result_id: resultId,
    prompt_sha256: job.prompt_sha256,
    input_sha256: job.input_sha256,
    output_sha256: job.raw_output_sha256,
    child_session_id: job.child_session_id,
    resolved_model: job.resolved_model,
  })
}

async function blockFailed(input: RunInput, job: CompletedJob): Promise<CertificationSchedulerResult> {
  return block(input, job.receipt.kind === "ERROR" && job.receipt.error_code === "ADAPTER_OUTPUT_INVALID"
    ? "ADAPTER_OUTPUT_INVALID" : "DISPATCH_FAILED")
}

async function blockProgressError(input: RunInput, code: string, message: string): Promise<CertificationSchedulerResult> {
  const reason = code === "STORAGE_READ_FAILED" || code === "STORAGE_WRITE_FAILED" ? code : "RECONCILIATION_AMBIGUOUS"
  const result = await input.commit_transition({ type: "BLOCK", reason })
  return result.kind === "ok" ? { ok: true } : failure(result.error_code, `${message}: ${result.message}`)
}

async function blockReason(
  input: RunInput,
  reason: "RECONCILIATION_AMBIGUOUS",
  message: string,
): Promise<CertificationSchedulerResult> {
  const result = await input.commit_transition({ type: "BLOCK", reason })
  return result.kind === "ok" ? { ok: true } : failure(result.error_code, `${message}: ${result.message}`)
}

async function block(input: RunInput, reason: "ADAPTER_OUTPUT_INVALID" | "DISPATCH_FAILED"): Promise<CertificationSchedulerResult> {
  return stateResult(await input.commit_transition({ type: "BLOCK", reason }))
}

function stateResult(result: Awaited<ReturnType<RunInput["commit_transition"]>>): CertificationSchedulerResult {
  return result.kind === "ok" ? { ok: true } : failure(result.error_code, result.message)
}

function failure(error_code: Extract<CertificationSchedulerResult, { readonly ok: false }>["error_code"], message: string) {
  return { ok: false as const, error_code, message }
}

function unavailableRuntime(): Parameters<typeof progressCertificationJobAttempt>[0]["runtime"] {
  const unavailable = async () => { throw new CertificationRoundRuntimeError() }
  return {
    verify_operation_owner: async () => ({ ok: true }),
    persist_job_attempt: unavailable,
    block_reconciliation: unavailable,
    list_children: unavailable,
    get_session: unavailable,
    list_messages: unavailable,
    dispatch: unavailable,
  }
}

class CertificationRoundAdapterError extends Error { readonly name = "CertificationRoundAdapterError" }
class CertificationRoundRuntimeError extends Error { readonly name = "CertificationRoundRuntimeError" }

function assertNever(value: never): never {
  throw new TypeError(`Unexpected extraction/coverage progress result: ${String(value)}`)
}
