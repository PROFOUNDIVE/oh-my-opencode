import { sha256 } from "../../../workflow/stage-runner/sha256"
import { extractionOutput, extractionSources } from "../adapters/extraction-adapter.test-fixture"
import { CertificationJobAttemptSchema, type CertificationJobAttempt } from "../state/jobs"
import { ResearchCertificationStateV1Schema, type ResearchCertificationStateV1 } from "../state/schema"
import { readyCertificationState } from "../state/certification-test-fixture"
import { CertificationGraphSourcesSchema } from "../state/graph-source-validation"
import { deriveCertificationIdentity } from "../state/identity"
import { reduceCertificationTransition } from "../transitions"
import type { CertificationJobProgressInput, CertificationJobProgressResult } from "../scheduler"
import type { CertificationJobRuntime } from "../scheduler"
import type { CompletedCertificationJob, FailedCertificationJob } from "../scheduler/certification-job-progress-types"
import type { ExtractionCoverageRoundContext } from "./extraction-coverage-types"

export function roundContext(maxCoverageRounds = 2): ExtractionCoverageRoundContext {
  const sources = extractionSources()
  return {
    parent_session_id: "ses_parent1",
    profile_sha256: "4".repeat(64),
    reference_sha256: "5".repeat(64),
    sources: CertificationGraphSourcesSchema.parse(sources),
    profile: {
      certification_profile_sha256: "2".repeat(64),
      max_obligations: 8,
      max_coverage_rounds: maxCoverageRounds,
      max_coverage_findings: 8,
      allowed_attack_modes: ["EDGE_CASE"],
      max_attacks_per_obligation: 1,
      max_active_certification_jobs: 4,
    },
    extraction_role: role("extractor"),
    coverage_role: role("coverage-reviewer"),
  }
}

export function roundState(): ResearchCertificationStateV1 {
  const context = roundContext()
  const identity = deriveCertificationIdentity({
    campaign_id: readyCertificationState().campaign_id,
    selected_artifact_sha256: context.sources.artifact.artifact_sha256,
    certification_profile_sha256: context.profile.certification_profile_sha256,
  })
  return ResearchCertificationStateV1Schema.parse({
    ...readyCertificationState(),
    ...identity,
    selected_artifact: context.sources.artifact,
    objective_sha256: context.sources.objective_sha256,
    certification_profile_sha256: context.profile.certification_profile_sha256,
  })
}

export function extractionRawOutput(): string {
  return JSON.stringify(extractionOutput())
}

export function coverageRawOutput(verdict: "PASS" | "REVISE" | "INCONCLUSIVE"): string {
  return JSON.stringify({ verdict, findings: verdict === "REVISE" ? [{
    kind: "MISSING_CLAIM",
    source_span: null,
    obligation_ids: [],
    message: "A claim is missing.",
    suggested_correction: "Add the missing claim.",
  }] : [] })
}

export function prepareState(state: ResearchCertificationStateV1, jobs: readonly CertificationJobAttempt[], amendments: readonly string[] = []) {
  const prepared = reduceCertificationTransition(state, {
    type: "PREPARE_OPERATION",
    job_attempts: jobs,
    consume_amendment_ids: amendments,
  }, state.certification_revision)
  if (!prepared.ok) throw new TypeError(prepared.message)
  return prepared.state
}

export function progressFrom(rawOutput: string) {
  return async (input: CertificationJobProgressInput): Promise<CertificationJobProgressResult> => {
    let receipt: Extract<CertificationJobAttempt, { readonly phase: "COMPLETED" }>["receipt"]
    try {
      receipt = input.receipt_from_output(rawOutput)
    } catch (error) {
      receipt = { kind: "ERROR", error_code: "ADAPTER_OUTPUT_INVALID", message: error instanceof Error ? error.message : String(error) }
    }
    const completed = CertificationJobAttemptSchema.parse({
      ...input.attempt,
      phase: "COMPLETED",
      phase_revision: input.attempt.phase_revision + 1,
      child_session_id: "ses_round1",
      raw_output_sha256: sha256(rawOutput),
      receipt,
    })
    if (completed.phase !== "COMPLETED") throw new TypeError("Expected completed round job")
    if (isFailedJob(completed)) return { kind: "failed", attempt: completed }
    return { kind: "completed", attempt: completed }
  }
}

export function persistedProgressFrom(
  rawOutput: string,
  receipt: Extract<CertificationJobAttempt, { readonly phase: "COMPLETED" }>["receipt"],
) {
  return async (input: CertificationJobProgressInput): Promise<CertificationJobProgressResult> => {
    const completed = CertificationJobAttemptSchema.parse({
      ...input.attempt,
      phase: "COMPLETED",
      phase_revision: input.attempt.phase_revision + 1,
      child_session_id: "ses_round1",
      raw_output_sha256: sha256(rawOutput),
      receipt,
    })
    if (completed.phase !== "COMPLETED" || isFailedJob(completed)) throw new TypeError("Expected successful persisted completion")
    return { kind: "completed", attempt: completed }
  }
}

export function failedProgressFrom(errorCode: string) {
  return async (input: CertificationJobProgressInput): Promise<CertificationJobProgressResult> => {
    const completed = CertificationJobAttemptSchema.parse({
      ...input.attempt,
      phase: "COMPLETED",
      phase_revision: input.attempt.phase_revision + 1,
      child_session_id: "ses_round1",
      raw_output_sha256: sha256("dispatch failed"),
      receipt: { kind: "ERROR", error_code: errorCode, message: "dispatch failed" },
    })
    if (completed.phase !== "COMPLETED" || !isFailedJob(completed)) throw new TypeError("Expected failed persisted completion")
    return { kind: "failed", attempt: completed }
  }
}

export function roundRuntime(rawOutput: string): CertificationJobRuntime {
  const unavailable = async () => { throw new TypeError("Unused round runtime operation") }
  return {
    verify_operation_owner: async () => ({ ok: true }),
    persist_job_attempt: unavailable,
    block_reconciliation: unavailable,
    list_children: unavailable,
    get_session: unavailable,
    list_messages: async () => [{ role: "assistant", text: rawOutput }],
    dispatch: unavailable,
  }
}

function isFailedJob(attempt: CompletedCertificationJob): attempt is FailedCertificationJob {
  return attempt.receipt.kind === "ERROR"
}

function role(agent: string) {
  const content = `${agent} prompt`
  return {
    agent,
    model: { providerID: "openai", modelID: "gpt-5" },
    prompt: { content, content_hash: sha256(content) },
  }
}
