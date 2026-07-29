import type { OpencodeClient, ToolContextWithMetadata } from "../delegate-task/types"
import type { OpenMathSessionState } from "../../openmath/types"

import type { OpenMathToolConfig } from "./tool-config"
import { runJsonRound } from "./json-round"
import { runMarkdownRound } from "./markdown-round"
import { getMarkdownRoundInputs } from "./markdown-round-policy"

export async function runSolveProblemRound(args: {
  client: OpencodeClient
  directory: string
  ctx: ToolContextWithMetadata
  config: OpenMathToolConfig | undefined
  artifactsFormat: "json" | "markdown"
  problemId: string
  problemText: string
  state: OpenMathSessionState
  textbookMarkdown?: string
  solveInput: Record<string, unknown>
  maxConsecutivePatchFailures: number
}): Promise<{
  readonly markdownInputs: ReturnType<typeof getMarkdownRoundInputs> | null
  readonly roundResult: Awaited<ReturnType<typeof runJsonRound>> | Awaited<ReturnType<typeof runMarkdownRound>>
}> {
  const round = args.state.review_round
  const markdownInputs = args.artifactsFormat === "markdown"
    ? getMarkdownRoundInputs({
        round,
        frozen_artifacts: args.state.frozen_artifacts,
        maxConsecutivePatchFailures: args.maxConsecutivePatchFailures,
      })
    : null
  const roundResult = args.artifactsFormat === "json"
    ? await runJsonRound({
        client: args.client,
        directory: args.directory,
        ctx: args.ctx,
        problemId: args.problemId,
        problemText: args.problemText,
        round,
        artifactVersion: args.state.artifact_version,
        textbook_markdown: args.textbookMarkdown,
        solveInput: args.solveInput,
      })
    : await runMarkdownRound({
        client: args.client,
        directory: args.directory,
        ctx: args.ctx,
        config: args.config,
        problemId: args.problemId,
        problemText: args.problemText,
        round,
        artifactVersion: args.state.artifact_version,
        textbook_markdown: args.textbookMarkdown,
        solveInput: args.solveInput,
        baseArtifacts: markdownInputs?.baseArtifacts,
        useSolverPatch: markdownInputs?.useSolverPatch,
      })
  return { markdownInputs, roundResult }
}
