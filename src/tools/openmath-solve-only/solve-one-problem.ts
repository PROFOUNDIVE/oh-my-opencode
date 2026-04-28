import type { OpencodeClient, ToolContextWithMetadata } from "../delegate-task/types"
import { writeOpenMathSessionState } from "../../openmath/storage"
import { applyOpenMathTransition } from "../../openmath/transitions"
import type { OpenMathSessionState, ReviewVerdict } from "../../openmath/types"

import type { OpenMathSolveOnlyResult } from "./types"
import type { OpenMathToolConfig } from "./tool-config"
import { normalizeProblem } from "./prompt"
import { ensureOpenMathState } from "./state-bootstrap"
import { runJsonRound } from "./json-round"
import { runMarkdownRound } from "./markdown-round"
import { applyMarkdownRoundOutcomeToDraft, getMarkdownRoundInputs } from "./markdown-round-policy"
import { shouldConsumeReviewBudgetForMarkdownError } from "./markdown-round-error-policy"
import { maybeAutoExport } from "./maybe-auto-export"
import { persistAfterReview } from "./persist-after-review"

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
  const problemSessionId = `${args.rootSessionId}::${args.problem.id}`
  const stateFilenameMode = args.config?.state_filename_mode ?? "linux"
  const artifactsFormat = args.config?.artifacts?.format ?? "markdown"
  const problemText = normalizeProblem(args.problem.prefix, args.problem.problem)

  const init = ensureOpenMathState({
    directory: args.directory,
    sessionId: problemSessionId,
    maxReviewRounds: args.maxReviewRounds,
    stateFilenameMode,
  })

  if (!init.ok) {
    return {
      id: args.problem.id,
      session_id: problemSessionId,
      rounds_used: 0,
      error_code: init.error_code,
      message: "Failed to initialize OpenMath state",
    }
  }

  let state: OpenMathSessionState = {
    ...applyOpenMathTransition(init.state, { type: "SOLVE_SUBMITTED" }).state,
    original_problem_text: problemText,
  }
  if (!writeOpenMathSessionState(args.directory, state, stateFilenameMode)) {
    return {
      id: args.problem.id,
      session_id: problemSessionId,
      rounds_used: 0,
      error_code: "STATE_WRITE_FAILED",
      message: "Failed to persist OpenMath state after SOLVE_SUBMITTED",
    }
  }

  const solveInput: Record<string, unknown> = {
    ...(args.subject ? { subject: args.subject } : {}),
    ...(args.chapter_context ? { chapter_context: args.chapter_context } : {}),
    problem: problemText,
    ...(args.textbook_markdown ? { textbook_markdown: args.textbook_markdown } : {}),
    supplementary_refs: args.supplementary_refs ?? null,
  }

  let roundsUsed = 0
  let lastVerdict: ReviewVerdict | undefined
  let lastSyntheticError:
    | {
        error_code: string
        stage?: "strip" | "candidate_scan" | "parse" | "schema"
        source: "reviewer" | "solver" | "patch"
      }
    | undefined

  while (state.review_round <= state.max_review_rounds) {
    roundsUsed++
    const round = state.review_round

    const markdownInputs =
      artifactsFormat === "markdown"
        ? getMarkdownRoundInputs({
            round,
            frozen_artifacts: state.frozen_artifacts,
            maxConsecutivePatchFailures: args.maxConsecutivePatchFailures,
          })
        : null

    const roundResult =
      artifactsFormat === "json"
        ? await runJsonRound({
            client: args.client,
            directory: args.directory,
            ctx: args.ctx,
            problemId: args.problem.id,
            problemText,
            round,
            artifactVersion: state.artifact_version,
            textbook_markdown: args.textbook_markdown,
            solveInput,
          })
        : await runMarkdownRound({
            client: args.client,
            directory: args.directory,
            ctx: args.ctx,
            config: args.config,
            problemId: args.problem.id,
            problemText,
            round,
            artifactVersion: state.artifact_version,
            textbook_markdown: args.textbook_markdown,
            solveInput,
            baseArtifacts: markdownInputs?.baseArtifacts,
            useSolverPatch: markdownInputs?.useSolverPatch,
          })

    if (!roundResult.ok) {
      const markdownSyntheticError =
        artifactsFormat === "markdown" && "synthetic_error" in roundResult
          ? (roundResult.synthetic_error as
              | {
                  error_code: string
                  stage?: "strip" | "candidate_scan" | "parse" | "schema"
                  source: "reviewer" | "solver" | "patch"
                }
              | undefined)
          : undefined

      if (markdownSyntheticError) {
        lastSyntheticError = markdownSyntheticError
      }

      const shouldConsumeBudget =
        artifactsFormat === "markdown"
        && shouldConsumeReviewBudgetForMarkdownError(roundResult.error_code)

      if (shouldConsumeBudget) {
        const transitioned = applyOpenMathTransition(state, {
          type: "REVIEW_REPORTED",
          verdict: "[ERROR]",
        }).state
        state = {
          ...transitioned,
          frozen_artifacts:
            transitioned.artifact_state === "UNFROZEN"
              ? null
              : state.frozen_artifacts,
        }

        if (!writeOpenMathSessionState(args.directory, state, stateFilenameMode)) {
          return {
            id: args.problem.id,
            session_id: problemSessionId,
            rounds_used: roundsUsed,
            verdict: "[ERROR]",
            error_code: "STATE_WRITE_FAILED",
            message: "Failed to persist OpenMath state after retryable round error",
          }
        }

        lastVerdict = "[ERROR]"
        if (state.review_round > state.max_review_rounds || state.artifact_state === "UNFROZEN") {
          return {
            id: args.problem.id,
            session_id: problemSessionId,
            rounds_used: roundsUsed,
            verdict: "[ERROR]",
            error_code: lastSyntheticError?.error_code ?? roundResult.error_code,
            message:
              lastSyntheticError
                ? `Synthetic ${lastSyntheticError.source} failure${lastSyntheticError.stage ? ` (${lastSyntheticError.stage})` : ""}`
                : roundResult.message,
          }
        }

        continue
      }

      state = { ...state, artifact_state: "UNFROZEN", frozen_artifacts: null }
      writeOpenMathSessionState(args.directory, state, stateFilenameMode)
      return {
        id: args.problem.id,
        session_id: problemSessionId,
        rounds_used: roundsUsed,
        verdict: "[ERROR]",
        error_code: lastSyntheticError?.error_code ?? roundResult.error_code,
        message:
          lastSyntheticError
            ? `Synthetic ${lastSyntheticError.source} failure${lastSyntheticError.stage ? ` (${lastSyntheticError.stage})` : ""}`
            : roundResult.message,
      }
    }

    const verdict = roundResult.verdict
    lastVerdict = verdict

    let draft = {
      ...roundResult.draft,
      review_certificate: {
        ...(roundResult.certificate ?? roundResult.draft.review_certificate),
        verdict,
      },
    }

    if (artifactsFormat === "markdown") {
      const markdownResult =
        roundResult as Extract<Awaited<ReturnType<typeof runMarkdownRound>>, { ok: true }>

      if (markdownResult.synthetic_error) {
        lastSyntheticError = markdownResult.synthetic_error
      } else if (verdict !== "[ERROR]") {
        lastSyntheticError = undefined
      }

      draft = applyMarkdownRoundOutcomeToDraft({
        draft,
        roundResult: {
          certificate: markdownResult.certificate,
          blocking_issues: markdownResult.blocking_issues,
          patch_failure: markdownResult.patch_failure,
        },
        prevBlockingIssues: markdownInputs?.prevBlockingIssues,
        prevPatchFailureState: markdownInputs?.prevPatchFailureState,
      })
    }

    const persisted = persistAfterReview({
      directory: args.directory,
      stateFilenameMode,
      state,
      draft,
      verdict,
    })
    if (!persisted.ok) {
      return {
        id: args.problem.id,
        session_id: problemSessionId,
        rounds_used: roundsUsed,
        verdict,
        error_code: "STATE_WRITE_FAILED",
        message: persisted.message,
      }
    }
    state = persisted.state

    if (verdict === "[CORRECT]") {
      const exported = await maybeAutoExport({
        directory: args.directory,
        config: args.config,
        ctx: args.ctx,
        sessionId: problemSessionId,
        prefix: args.problem.prefix ?? args.problem.id,
        exportDir: args.exportDir,
        enabled: args.autoExport,
      })

      return {
        id: args.problem.id,
        session_id: problemSessionId,
        rounds_used: roundsUsed,
        verdict,
        ...(exported ? { exported } : {}),
      }
    }

    if (verdict === "[INCONCLUSIVE]" || state.artifact_state === "UNFROZEN") {
      return {
        id: args.problem.id,
        session_id: problemSessionId,
        rounds_used: roundsUsed,
        verdict,
        ...(verdict === "[ERROR]" && lastSyntheticError
          ? {
              error_code: lastSyntheticError.error_code,
              message: `Synthetic ${lastSyntheticError.source} failure${lastSyntheticError.stage ? ` (${lastSyntheticError.stage})` : ""}`,
            }
          : {}),
      }
    }
  }

  return {
    id: args.problem.id,
    session_id: problemSessionId,
    rounds_used: roundsUsed,
    verdict: lastVerdict ?? "[ERROR]",
    ...(lastVerdict === "[ERROR]" && lastSyntheticError
      ? {
          error_code: lastSyntheticError.error_code,
          message: `Synthetic ${lastSyntheticError.source} failure${lastSyntheticError.stage ? ` (${lastSyntheticError.stage})` : ""}`,
        }
      : {}),
  }
}
