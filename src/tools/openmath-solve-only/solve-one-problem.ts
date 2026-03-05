import type { OpencodeClient, ToolContextWithMetadata } from "../delegate-task/types"
import { writeOpenMathSessionState } from "../../openmath/storage"
import { applyOpenMathTransition } from "../../openmath/transitions"
import type { ReviewVerdict } from "../../openmath/types"

import type { OpenMathSolveOnlyResult } from "./types"
import type { OpenMathToolConfig } from "./tool-config"
import { normalizeProblem } from "./prompt"
import { ensureOpenMathState } from "./state-bootstrap"
import { runJsonRound } from "./json-round"
import { runMarkdownRound } from "./markdown-round"
import { applyMarkdownRoundOutcomeToDraft, getMarkdownRoundInputs } from "./markdown-round-policy"
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
  autoExport: boolean
  exportDir?: string
}): Promise<OpenMathSolveOnlyResult> {
  const problemSessionId = `${args.rootSessionId}::${args.problem.id}`
  const artifactsFormat = args.config?.artifacts?.format ?? "markdown"
  const problemText = normalizeProblem(args.problem.prefix, args.problem.problem)

  const init = ensureOpenMathState({
    directory: args.directory,
    sessionId: problemSessionId,
    maxReviewRounds: args.maxReviewRounds,
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

  let state = applyOpenMathTransition(init.state, { type: "SOLVE_SUBMITTED" }).state
  if (!writeOpenMathSessionState(args.directory, state)) {
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

  while (state.review_round <= state.max_review_rounds) {
    roundsUsed++
    const round = state.review_round

    const markdownInputs =
      artifactsFormat === "markdown"
        ? getMarkdownRoundInputs({ round, frozen_artifacts: state.frozen_artifacts })
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
      state = { ...state, artifact_state: "UNFROZEN", frozen_artifacts: null }
      writeOpenMathSessionState(args.directory, state)
      return {
        id: args.problem.id,
        session_id: problemSessionId,
        rounds_used: roundsUsed,
        verdict: "[ERROR]",
        error_code: roundResult.error_code,
        message: roundResult.message,
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
      return { id: args.problem.id, session_id: problemSessionId, rounds_used: roundsUsed, verdict }
    }
  }

  return {
    id: args.problem.id,
    session_id: problemSessionId,
    rounds_used: roundsUsed,
    verdict: lastVerdict ?? "[ERROR]",
  }
}
