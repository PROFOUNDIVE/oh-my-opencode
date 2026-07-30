import type { OpencodeClient, ToolContextWithMetadata } from "../delegate-task/types"
import { createLegacyReferenceSnapshot } from "../../openmath/references/snapshot"
import { readOpenMathSessionStateBytes, writeOpenMathSessionState, type OpenMathStateFilenameMode } from "../../openmath/storage"
import { createInitialWorkflowState } from "../../openmath/workflow/transitions"
import { runWorkflowStep } from "../../openmath/workflow/stage-runner"
import { readWorkflowState, startWorkflowState } from "../../openmath/workflow/storage"
import { importLegacySolveOnlyState, projectWorkflowStateToLegacy, ReferenceSnapshotSchema, WorkflowRequestSnapshotSchema, WorkflowStateV1Schema, type WorkflowStateV1 } from "../../openmath/workflow/state"
import type { OpenMathSolveOnlyResult } from "./types"
import type { OpenMathToolConfig } from "./tool-config"
import { createLegacyWorkflowProfileSnapshot } from "./legacy-workflow-profile"
import { createLegacyWorkflowRuntime } from "./legacy-workflow-runtime"
import { recoverLegacyParseFailure } from "./legacy-workflow-recovery"
import { maybeAutoExport } from "./maybe-auto-export"
import { normalizeProblem } from "./prompt"

export async function runLegacyWorkflow(input: Readonly<{
  readonly directory: string
  readonly client: OpencodeClient
  readonly ctx: ToolContextWithMetadata
  readonly config: OpenMathToolConfig | undefined
  readonly rootSessionId: string
  readonly subject?: string
  readonly chapter_context?: string
  readonly textbook_markdown?: string
  readonly supplementary_refs?: string[]
  readonly problem: { readonly id: string; readonly problem: string; readonly prefix?: string }
  readonly maxReviewRounds: number
  readonly maxConsecutivePatchFailures: number
  readonly autoExport: boolean
  readonly exportDir?: string
}>): Promise<OpenMathSolveOnlyResult> {
  const runId = `${input.rootSessionId}::${input.problem.id}`
  const format = input.config?.artifacts?.format ?? "markdown"
  const stateFilenameMode = input.config?.state_filename_mode ?? "linux"
  const problemText = normalizeProblem(input.problem.prefix, input.problem.problem)
  const initial = await loadOrStartWorkflow({
    ...input,
    runId,
    format,
    problemText,
    stateFilenameMode,
  })
  if (initial.kind === "error") {
    return { id: input.problem.id, session_id: runId, rounds_used: 0, error_code: initial.error_code, message: initial.message }
  }
  const state = await runUntilSettled(input, initial.state, stateFilenameMode)
  const projected = projectWorkflowStateToLegacy(state)
  if (projected.kind === "error" || !writeOpenMathSessionState(input.directory, projected.state, stateFilenameMode)) {
    return { id: input.problem.id, session_id: runId, rounds_used: state.completed_review_rounds, error_code: "STATE_WRITE_FAILED", message: "Failed to persist OpenMath state after review" }
  }
  return resultFromWorkflow(input, state)
}

async function loadOrStartWorkflow(input: Readonly<{
  readonly directory: string
  readonly client: OpencodeClient
  readonly ctx: ToolContextWithMetadata
  readonly config: OpenMathToolConfig | undefined
  readonly rootSessionId: string
  readonly subject?: string
  readonly chapter_context?: string
  readonly textbook_markdown?: string
  readonly supplementary_refs?: string[]
  readonly problem: { readonly id: string; readonly problem: string; readonly prefix?: string }
  readonly maxReviewRounds: number
  readonly maxConsecutivePatchFailures: number
  readonly autoExport: boolean
  readonly exportDir?: string
  readonly runId: string
  readonly format: "markdown" | "json"
  readonly problemText: string
  readonly stateFilenameMode: OpenMathStateFilenameMode
}>): Promise<Readonly<{ readonly kind: "ok"; readonly state: WorkflowStateV1 }> | Readonly<{ readonly kind: "error"; readonly error_code: string; readonly message: string }>> {
  const existing = await readWorkflowState(input.directory, input.runId)
  if (existing.kind === "ok") return existing
  if (existing.error_code === "STORAGE_READ_FAILED") return existing
  const request = WorkflowRequestSnapshotSchema.parse({
    kind: "problem",
    source: { kind: "text", text: input.problemText },
    problem_text: input.problemText,
    ...(input.subject ? { subject: input.subject } : {}),
    ...(input.chapter_context ? { chapter_context: input.chapter_context } : {}),
    ...(input.textbook_markdown ? { textbook_markdown: input.textbook_markdown } : {}),
    ...(input.supplementary_refs ? { supplementary_refs: input.supplementary_refs } : {}),
  })
  const profile = createLegacyWorkflowProfileSnapshot(input.format, input.maxReviewRounds)
  const references = ReferenceSnapshotSchema.parse(createLegacyReferenceSnapshot(input.supplementary_refs ?? []))
  const legacyBytes = readOpenMathSessionStateBytes(input.directory, input.runId, input.stateFilenameMode)
  const imported = legacyBytes === null ? null : importLegacySolveOnlyState({
    source_bytes: legacyBytes,
    parent_session_id: input.ctx.sessionID,
    legacy_profile_name: profile.name,
    invocation: "solve_only",
    profile_snapshot: profile,
    reference_snapshot: references,
    existing_state: null,
  })
  if (imported?.kind === "error") return imported
  const state = imported?.kind === "imported"
    ? WorkflowStateV1Schema.parse({ ...imported.state, request_snapshot: request })
    : createInitialWorkflowState({
    run_id: input.runId,
    parent_session_id: input.ctx.sessionID,
    request_snapshot: request,
    profile_snapshot: profile,
    reference_snapshot: references,
    legacy_projection: {
      kind: "solve_only",
      schema_version: 1,
      session_id: input.runId,
      original_problem_text: input.problemText,
      artifact_state: "DRAFT",
      max_review_rounds: input.maxReviewRounds,
      hint_budget_state: { hints_used: 0, hint_budget: 3 },
      markdown_fallback: input.format === "markdown" ? {
        max_consecutive_patch_failures: input.maxConsecutivePatchFailures,
        max_ops: input.config?.artifacts?.patch?.max_ops ?? null,
        allow_unique_substring_replace: input.config?.artifacts?.patch?.allow_unique_substring_replace ?? null,
        consecutive_failures: 0,
        last_error_code: null,
        last_section_id: null,
        regenerate_next: false,
        sub_attempt_history: [],
      } : null,
    },
  })
  const started = await startWorkflowState({ directory: input.directory, state })
  if (started.kind === "error") return started
  const projected = projectWorkflowStateToLegacy(started.state)
  if (projected.kind === "error" || !writeOpenMathSessionState(input.directory, projected.state, input.stateFilenameMode)) {
    return { kind: "error", error_code: "STATE_WRITE_FAILED", message: "Failed to initialize OpenMath state" }
  }
  return started
}

async function runUntilSettled(
  input: Parameters<typeof runLegacyWorkflow>[0],
  state: WorkflowStateV1,
  stateFilenameMode: OpenMathStateFilenameMode,
): Promise<WorkflowStateV1> {
  const resumed = await recoverLegacyParseFailure(input.directory, state)
  if (resumed.state_revision !== state.state_revision) return runUntilSettled(input, resumed, stateFilenameMode)
  if (!isRunnable(state)) return state
  const completed = await runWorkflowStep({
    state,
    workflow_input: JSON.stringify(state.request_snapshot),
    mode: "to_checkpoint",
    runtime: createLegacyWorkflowRuntime({
      state,
      directory: input.directory,
      client: input.client,
      ctx: input.ctx,
      state_filename_mode: stateFilenameMode,
    }),
  })
  const recovered = await recoverLegacyParseFailure(input.directory, completed)
  return recovered.state_revision === completed.state_revision
    ? completed
    : runUntilSettled(input, recovered, stateFilenameMode)
}

async function resultFromWorkflow(
  input: Parameters<typeof runLegacyWorkflow>[0],
  state: WorkflowStateV1,
): Promise<OpenMathSolveOnlyResult> {
  const lastAttempt = state.dispatch_attempts.findLast((attempt) => attempt.phase === "COMMITTED")
  const roundsUsed = Math.max(state.completed_review_rounds, lastAttempt?.review_round ?? 0)
  if (state.status === "PASSED") {
    const exported = await maybeAutoExport({
      directory: input.directory,
      config: input.config,
      ctx: input.ctx,
      sessionId: state.run_id,
      prefix: input.problem.prefix ?? input.problem.id,
      exportDir: input.exportDir,
      enabled: input.autoExport,
    })
    return { id: input.problem.id, session_id: state.run_id, rounds_used: roundsUsed, verdict: "[CORRECT]", ...(exported ? { exported } : {}) }
  }
  const verdict = state.latest_review?.verdict === "INCONCLUSIVE" ? "[INCONCLUSIVE]" as const : "[ERROR]" as const
  const errorAttempt = state.dispatch_attempts.findLast((attempt) => attempt.phase === "COMMITTED" && attempt.receipt.kind === "ERROR")
  const errorCode = errorAttempt?.phase === "COMMITTED" && errorAttempt.receipt.kind === "ERROR"
    ? legacyErrorCode(errorAttempt.stage, errorAttempt.receipt.error_code, errorAttempt.receipt.message)
    : undefined
  return {
    id: input.problem.id,
    session_id: state.run_id,
    rounds_used: roundsUsed,
    verdict,
    ...(errorCode === undefined ? {} : { error_code: errorCode }),
    ...(errorAttempt?.phase === "COMMITTED" && "adapter_error" in errorAttempt.receipt
      ? { message: `Synthetic ${errorAttempt.stage === "SOLVE" ? "solver" : errorAttempt.stage === "REVIEW" ? "reviewer" : "patch"} failure${syntheticStage(errorAttempt.stage, errorAttempt.receipt.adapter_error.code)}` }
      : {}),
  }
}

function syntheticStage(stage: "SOLVE" | "REVIEW" | "REVISE", code: string): string {
  if (stage === "REVIEW" && code === "INVALID_JSON") return " (candidate_scan)"
  if (stage === "REVISE" && code === "INVALID_PATCH_SET") return " (schema)"
  return ""
}

function legacyErrorCode(stage: "SOLVE" | "REVIEW" | "REVISE", code: string, message: string): string {
  if (code === "SUBAGENT_FAILED" && message.toLowerCase().includes("agent \"") && message.toLowerCase().includes("not found")) {
    return "AGENT_NOT_FOUND"
  }
  if (code !== "ADAPTER_OUTPUT_INVALID") return code
  if (stage === "SOLVE") return "ARTIFACTS_PARSE_ERROR"
  if (stage === "REVIEW") return "REVIEWER_OUTPUT_INVALID"
  return "PATCH_OUTPUT_INVALID"
}

function isRunnable(state: WorkflowStateV1): state is Extract<WorkflowStateV1, { readonly status: "READY" | "RUNNING" | "BLOCKED" }> {
  return state.status === "READY" || state.status === "RUNNING" || state.status === "BLOCKED"
}
