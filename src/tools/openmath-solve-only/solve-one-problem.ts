import type { OpencodeClient, ToolContextWithMetadata } from "../delegate-task/types"
import type { OpenMathSessionState, ReviewVerdict } from "../../openmath/types"

import type { OpenMathSolveOnlyResult } from "./types"
import type { OpenMathToolConfig } from "./tool-config"
import { normalizeProblem } from "./prompt"
import { applyMarkdownRoundOutcomeToDraft } from "./markdown-round-policy"
import { shouldConsumeReviewBudgetForMarkdownError } from "./markdown-round-error-policy"
import { maybeAutoExport } from "./maybe-auto-export"
import { persistAfterReview } from "./persist-after-review"
import { createRoundFailureResult, type SyntheticRoundError } from "./round-failure-result"
import { createRoundSuccessResult } from "./round-success-result"
import { runSolveProblemRound } from "./solve-problem-round"
import {
  consumeReviewBudgetForRoundFailure,
  initializeSolveProblemState,
  unfreezeStateAfterRoundFailure,
} from "./solve-problem-state"

export async function solveOneProblem(args: {
  directory: string
  client: OpencodeClient
  ctx: ToolContextWithMetadata
  config: OpenMathToolConfig | undefined
  rootSessionId: string
  subject?: string
  chapter_context?: string
  textbook_markdown?: string
  supplementary_refs?: string[]
  problem: { id: string; problem: string; prefix?: string }
  maxReviewRounds: number
  maxConsecutivePatchFailures: number
  autoExport: boolean
  exportDir?: string
}): Promise<OpenMathSolveOnlyResult> {
  const stateFilenameMode = args.config?.state_filename_mode ?? "linux"
  const artifactsFormat = args.config?.artifacts?.format ?? "markdown"
  const problemText = normalizeProblem(args.problem.prefix, args.problem.problem)
  const initialized = initializeSolveProblemState({
    directory: args.directory,
    rootSessionId: args.rootSessionId,
    problemId: args.problem.id,
    problemText,
    maxReviewRounds: args.maxReviewRounds,
    stateFilenameMode,
  })
  if (!initialized.ok) {
    return createRoundFailureResult({
      id: args.problem.id,
      sessionId: initialized.sessionId,
      roundsUsed: 0,
      errorCode: initialized.errorCode,
      message: initialized.message,
    })
  }

  const solveInput: Record<string, unknown> = {
    ...(args.subject ? { subject: args.subject } : {}),
    ...(args.chapter_context ? { chapter_context: args.chapter_context } : {}),
    problem: problemText,
    ...(args.textbook_markdown ? { textbook_markdown: args.textbook_markdown } : {}),
    supplementary_refs: args.supplementary_refs ?? null,
  }
  let state: OpenMathSessionState = initialized.state
  let roundsUsed = 0
  let lastVerdict: ReviewVerdict | undefined
  let lastSyntheticError: SyntheticRoundError | undefined

  while (state.review_round <= state.max_review_rounds) {
    roundsUsed++
    const { markdownInputs, roundResult } = await runSolveProblemRound({
      client: args.client,
      directory: args.directory,
      ctx: args.ctx,
      config: args.config,
      artifactsFormat,
      problemId: args.problem.id,
      problemText,
      state,
      textbookMarkdown: args.textbook_markdown,
      solveInput,
      maxConsecutivePatchFailures: args.maxConsecutivePatchFailures,
    })

    if (!roundResult.ok) {
      if (artifactsFormat === "markdown" && "synthetic_error" in roundResult && roundResult.synthetic_error) {
        lastSyntheticError = roundResult.synthetic_error
      }
      const shouldConsumeBudget = artifactsFormat === "markdown"
        && shouldConsumeReviewBudgetForMarkdownError(roundResult.error_code)
      if (shouldConsumeBudget) {
        const consumed = consumeReviewBudgetForRoundFailure({ directory: args.directory, stateFilenameMode, state })
        if (!consumed.ok) {
          return createRoundFailureResult({
            id: args.problem.id,
            sessionId: initialized.sessionId,
            roundsUsed,
            verdict: "[ERROR]",
            errorCode: "STATE_WRITE_FAILED",
            message: "Failed to persist OpenMath state after retryable round error",
          })
        }
        state = consumed.state
        lastVerdict = "[ERROR]"
        if (state.review_round > state.max_review_rounds || state.artifact_state === "UNFROZEN") {
          return createRoundFailureResult({
            id: args.problem.id,
            sessionId: initialized.sessionId,
            roundsUsed,
            verdict: "[ERROR]",
            errorCode: roundResult.error_code,
            message: roundResult.message,
            syntheticError: lastSyntheticError,
            useSyntheticError: true,
          })
        }
        continue
      }

      state = unfreezeStateAfterRoundFailure({ directory: args.directory, stateFilenameMode, state })
      return createRoundFailureResult({
        id: args.problem.id,
        sessionId: initialized.sessionId,
        roundsUsed,
        verdict: "[ERROR]",
        errorCode: roundResult.error_code,
        message: roundResult.message,
        syntheticError: lastSyntheticError,
        useSyntheticError: true,
      })
    }

    const verdict = roundResult.verdict
    lastVerdict = verdict
    let draft = {
      ...roundResult.draft,
      review_certificate: { ...(roundResult.certificate ?? roundResult.draft.review_certificate), verdict },
    }
    if (artifactsFormat === "markdown" && "blocking_issues" in roundResult) {
      if (roundResult.synthetic_error) lastSyntheticError = roundResult.synthetic_error
      else if (verdict !== "[ERROR]") lastSyntheticError = undefined
      draft = applyMarkdownRoundOutcomeToDraft({
        draft,
        roundResult: {
          certificate: roundResult.certificate,
          blocking_issues: roundResult.blocking_issues,
          patch_failure: roundResult.patch_failure,
        },
        prevBlockingIssues: markdownInputs?.prevBlockingIssues,
        prevPatchFailureState: markdownInputs?.prevPatchFailureState,
      })
    }

    const persisted = persistAfterReview({ directory: args.directory, stateFilenameMode, state, draft, verdict })
    if (!persisted.ok) {
      return createRoundFailureResult({
        id: args.problem.id,
        sessionId: initialized.sessionId,
        roundsUsed,
        verdict,
        errorCode: "STATE_WRITE_FAILED",
        message: persisted.message,
      })
    }
    state = persisted.state
    if (verdict === "[CORRECT]") {
      const exported = await maybeAutoExport({
        directory: args.directory,
        config: args.config,
        ctx: args.ctx,
        sessionId: initialized.sessionId,
        prefix: args.problem.prefix ?? args.problem.id,
        exportDir: args.exportDir,
        enabled: args.autoExport,
      })
      return createRoundSuccessResult({
        id: args.problem.id,
        sessionId: initialized.sessionId,
        roundsUsed,
        verdict,
        exported,
      })
    }
    if (verdict === "[INCONCLUSIVE]" || state.artifact_state === "UNFROZEN") {
      return createRoundFailureResult({
        id: args.problem.id,
        sessionId: initialized.sessionId,
        roundsUsed,
        verdict,
        syntheticError: lastSyntheticError,
        useSyntheticError: verdict === "[ERROR]",
      })
    }
  }

  return createRoundFailureResult({
    id: args.problem.id,
    sessionId: initialized.sessionId,
    roundsUsed,
    verdict: lastVerdict ?? "[ERROR]",
    syntheticError: lastSyntheticError,
    useSyntheticError: lastVerdict === "[ERROR]",
  })
}
