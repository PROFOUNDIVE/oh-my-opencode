import { adaptWorkflowOutput } from "../adapters/adapter-dispatch"
import type { WorkflowStateV1 } from "../state"
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
  const adapted = adaptWorkflowOutput(adapterInput(role.output_adapter, input.raw_output, input.state.artifact?.content))
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
          sha256: adapted.artifact.hash,
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

export function subagentFailureReceipt(message: string): StageReceipt {
  return { kind: "ERROR", error_code: "SUBAGENT_FAILED", message }
}

function adapterInput(adapter: RunningState["profile_snapshot"]["solve"]["output_adapter"], rawOutput: string, baseMarkdown: string | undefined) {
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
      return { adapter, raw_output: rawOutput, base_markdown: baseMarkdown ?? "" } as const
    case "full_replace_markdown":
      return { adapter, raw_output: rawOutput } as const
    default:
      return assertNever(adapter)
  }
}

function nextArtifactVersion(state: RunningState, stage: PromptSentAttempt["stage"]): number {
  return stage === "REVISE" ? state.artifact_version + 1 : state.artifact_version
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected stage adapter: ${String(value)}`)
}
