import type { FrozenArtifacts } from "../../openmath/types"

import {
  readMarkdownOrchestratorState,
  mergeMarkdownOrchestratorState,
  nextPatchFailureState,
  type MarkdownPatchFailureState,
} from "./markdown-orchestrator-state"

export function getMarkdownRoundInputs(args: {
  round: number
  frozen_artifacts: FrozenArtifacts | null
  maxConsecutivePatchFailures: number
}): {
  baseArtifacts:
    | {
        artifacts_markdown: string
        artifacts_hash: string
        last_blocking_issues?: unknown
      }
    | undefined
  useSolverPatch: boolean | undefined
  prevBlockingIssues: unknown
  prevPatchFailureState: MarkdownPatchFailureState | undefined
} {
  const orchestrator = args.frozen_artifacts
    ? readMarkdownOrchestratorState(args.frozen_artifacts.hint_ladder)
    : null

  const prevBlockingIssues = orchestrator?.last_blocking_issues
  const prevPatchFailureState: MarkdownPatchFailureState | undefined = orchestrator?.patch_failure_state

  const baseArtifacts = orchestrator
    ? {
        artifacts_markdown: orchestrator.artifacts_markdown,
        artifacts_hash: orchestrator.artifacts_hash,
        last_blocking_issues: prevBlockingIssues,
      }
    : undefined

  const useSolverPatch =
    shouldUseMarkdownPatch({
      round: args.round,
      hasBaseArtifacts: baseArtifacts !== undefined,
      previousFailureState: prevPatchFailureState,
      maxConsecutivePatchFailures: args.maxConsecutivePatchFailures,
    })

  return { baseArtifacts, useSolverPatch, prevBlockingIssues, prevPatchFailureState }
}

export function shouldUseMarkdownPatch(args: {
  readonly round: number
  readonly hasBaseArtifacts: boolean
  readonly previousFailureState: MarkdownPatchFailureState | undefined
  readonly maxConsecutivePatchFailures: number
}): boolean | undefined {
  return args.round > 1
    ? (args.previousFailureState?.consecutive_failures ?? 0) < args.maxConsecutivePatchFailures && args.hasBaseArtifacts
    : undefined
}

export function nextMarkdownPatchFailureState(
  previous: MarkdownPatchFailureState | undefined,
  failure: { readonly error_code: string; readonly section_id?: string } | null,
): MarkdownPatchFailureState | undefined {
  return nextPatchFailureState({ prev: previous, failure, resetOnSuccess: true })
}

export function applyMarkdownRoundOutcomeToDraft(args: {
  draft: FrozenArtifacts
  roundResult: {
    certificate: unknown | null
    blocking_issues: unknown[]
    patch_failure: null | { error_code: string; section_id?: string }
  }
  prevBlockingIssues: unknown | undefined
  prevPatchFailureState: MarkdownPatchFailureState | undefined
}): FrozenArtifacts {
  const nextBlockingIssues = args.roundResult.certificate ? args.roundResult.blocking_issues : args.prevBlockingIssues
  const nextFailureState = nextMarkdownPatchFailureState(args.prevPatchFailureState, args.roundResult.patch_failure)

  return {
    ...args.draft,
    hint_ladder: mergeMarkdownOrchestratorState(args.draft.hint_ladder, {
      ...(typeof nextBlockingIssues !== "undefined" ? { last_blocking_issues: nextBlockingIssues } : {}),
      patch_failure_state: nextFailureState,
      last_patch_failure: args.roundResult.patch_failure,
    }),
  }
}
