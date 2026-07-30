import { adaptWorkflowOutput } from "../adapters/adapter-dispatch"
import type { WorkflowStateV1 } from "../state"
import type { WorkflowErrorCode } from "../state/literals"
import { roleForWorkflowStage } from "./stage-role"
import { sha256 } from "./sha256"

type RunningState = Extract<WorkflowStateV1, { readonly status: "RUNNING" }>
type PromptSentAttempt = Extract<WorkflowStateV1["dispatch_attempts"][number], { readonly phase: "PROMPT_SENT" }>
type StageReceipt = Extract<WorkflowStateV1["dispatch_attempts"][number], { readonly phase: "COMPLETED" }>["receipt"]

export function stageReceiptFromOutput(input: Readonly<{
  readonly state: RunningState
  readonly attempt: PromptSentAttempt
  readonly raw_output: string
}>): StageReceipt {
  const role = roleForWorkflowStage(input.state, input.attempt.stage)
  const adapted = adaptWorkflowOutput(adapterInput(role.output_adapter, input.raw_output, input.state))
  if (!adapted.ok) {
    return {
      kind: "ERROR",
      error_code: "ADAPTER_OUTPUT_INVALID",
      message: adapted.error.message,
      adapter_error: adapted.error,
    }
  }
  switch (adapted.kind) {
    case "markdown_artifact":
      return {
        kind: "ARTIFACT",
        artifact: {
          version: nextArtifactVersion(input.state, input.attempt.stage),
          media_type: "text/markdown",
          content: adapted.artifact.content,
          sha256: sha256(adapted.artifact.content),
        },
      }
    case "legacy_json_artifacts": {
      const content = JSON.stringify(adapted.artifacts)
      return {
        kind: "ARTIFACT",
        artifact: {
          version: nextArtifactVersion(input.state, input.attempt.stage),
          media_type: "application/vnd.openmath.legacy+json",
          content,
          sha256: sha256(content),
        },
      }
    }
    case "review":
      return {
        kind: "REVIEW",
        ...(adapted.review.legacy_metadata === undefined ? {} : { legacy_metadata: adapted.review.legacy_metadata }),
        review: {
          round: input.state.review_round,
          verdict: adapted.review.verdict,
          raw_report: adapted.review.raw_report,
          raw_report_sha256: sha256(adapted.review.raw_report),
          findings: [],
          checks_performed: ["artifact_correctness", "reference_consistency"],
          session_id: input.attempt.child_session_id,
          prompt_hash: input.attempt.prompt_hash,
          reference_hash: input.attempt.reference_hash,
          artifact_input_hash: input.attempt.artifact_input_hash,
        },
      }
    default:
      return assertNever(adapted)
  }
}

export function subagentFailureReceipt(
  message: string,
  errorCode: Exclude<WorkflowErrorCode, "ADAPTER_OUTPUT_INVALID"> = "SUBAGENT_FAILED",
): StageReceipt {
  return { kind: "ERROR", error_code: errorCode, message }
}

function adapterInput(adapter: RunningState["profile_snapshot"]["solve"]["output_adapter"], rawOutput: string, state: RunningState) {
  switch (adapter) {
    case "legacy_omo_sections":
      return { adapter, raw_output: rawOutput } as const
    case "legacy_json_artifacts":
      return { adapter, raw_output: rawOutput } as const
    case "opaque_markdown":
      return { adapter, raw_output: rawOutput } as const
    case "review_verdict_json":
      return { adapter, raw_output: rawOutput } as const
    case "review_verdict_markdown":
      return { adapter, raw_output: rawOutput } as const
    case "patch_set_json":
      return {
        adapter,
        raw_output: rawOutput,
        base_markdown: state.artifact?.content ?? "",
        ...(legacyPatchOptions(state) ? { patch_options: legacyPatchOptions(state) } : {}),
      } as const
    case "full_replace_markdown":
      return { adapter, raw_output: rawOutput } as const
    default:
      return assertNever(adapter)
  }
}

function legacyPatchOptions(state: RunningState) {
  if (state.legacy_projection.kind !== "solve_only" || state.legacy_projection.markdown_fallback === null) return undefined
  const fallback = state.legacy_projection.markdown_fallback
  if (fallback.max_ops === null && fallback.allow_unique_substring_replace === null) return undefined
  return {
    ...(fallback.max_ops === null ? {} : { max_ops: fallback.max_ops }),
    ...(fallback.allow_unique_substring_replace === null ? {} : { allow_unique_substring_replace: fallback.allow_unique_substring_replace }),
  }
}

function nextArtifactVersion(state: RunningState, stage: PromptSentAttempt["stage"]): number {
  return stage === "REVISE" ? state.artifact_version + 1 : state.artifact_version
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected stage adapter: ${String(value)}`)
}
