import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool"

import type { OpencodeClient } from "../delegate-task/types"
import type { OpenMathToolConfig } from "./tool-config"
import { createSemaphore } from "./semaphore"
import { solveOneProblem } from "./solve-one-problem"
import { ProblemRefNotFoundError, resolveProblemRefToProblemText } from "./problem-ref"
import { OpenMathSolveOnlyInputSchema } from "./types"

export function createOpenMathSolveOnlyTool(args: {
  directory: string
  client: OpencodeClient
  openmathConfig?: OpenMathToolConfig
}): ToolDefinition {
  return tool({
    description:
      "Deterministic solve-only orchestration over multiple problems with configurable concurrency. Runs SOLVE->REVIEW loops and freezes artifacts on [CORRECT].",
    args: {
      session_id: tool.schema.string().describe("OpenMath root session id"),
      problems: tool.schema
        .array(tool.schema.record(tool.schema.string(), tool.schema.unknown()))
        .describe("Batch problems: [{ id, problem, prefix? }]") as any,
      subject: tool.schema.string().optional(),
      chapter_context: tool.schema.string().optional(),
      textbook_markdown: tool.schema.string().optional(),
      supplementary_refs: tool.schema.array(tool.schema.string()).optional(),
      max_concurrency: tool.schema.number().optional(),
      max_review_rounds: tool.schema.number().optional(),
      auto_export: tool.schema.boolean().optional(),
      export_dir: tool.schema.string().optional(),
    },
    execute: async (rawArgs: Record<string, unknown>, ctx) => {
      try {
        const validated = OpenMathSolveOnlyInputSchema.parse(rawArgs)

        const resolvedProblems = await Promise.all(
          validated.problems.map(async (p) => {
            if (p.problem_ref) {
              const resolved = await resolveProblemRefToProblemText({
                projectDir: args.directory,
                problemRef: p.problem_ref,
              })
              return { id: p.id, prefix: p.prefix, problem: resolved.problem }
            }
            return { id: p.id, prefix: p.prefix, problem: p.problem ?? "" }
          }),
        )

        const maxRounds = validated.max_review_rounds ?? args.openmathConfig?.max_review_rounds ?? 3
        const effectiveMaxReviewRounds = Math.max(1, Math.min(maxRounds, 20))

        const configConcurrency = args.openmathConfig?.solve_only?.max_concurrency
        const requested = Math.min(
          validated.max_concurrency ?? Number.POSITIVE_INFINITY,
          configConcurrency ?? Number.POSITIVE_INFINITY,
          20,
        )
        const effectiveMaxConcurrency = Number.isFinite(requested) ? Math.max(1, requested) : 1

        const autoExport = validated.auto_export ?? args.openmathConfig?.solve_only?.auto_export ?? false
        const exportDir = validated.export_dir ?? args.openmathConfig?.solve_only?.export_dir

        const semaphore = createSemaphore(effectiveMaxConcurrency)
        const results = new Array(resolvedProblems.length)

        await Promise.all(
          resolvedProblems.map((problem, idx) =>
            semaphore.run(async () => {
              results[idx] = await solveOneProblem({
                directory: args.directory,
                client: args.client,
                ctx: ctx as any,
                config: args.openmathConfig,
                rootSessionId: validated.session_id,
                subject: validated.subject,
                chapter_context: validated.chapter_context,
                textbook_markdown: validated.textbook_markdown,
                supplementary_refs: validated.supplementary_refs,
                problem,
                maxReviewRounds: effectiveMaxReviewRounds,
                autoExport,
                exportDir,
              })
            }),
          ),
        )

        return JSON.stringify({ ok: true, results })
      } catch (error) {
        if (error instanceof ProblemRefNotFoundError) {
          return JSON.stringify({ ok: false, error_code: error.error_code, message: error.message })
        }
        if (error instanceof Error) {
          return JSON.stringify({ ok: false, error_code: "VALIDATION_ERROR", message: error.message })
        }
        return JSON.stringify({ ok: false, error_code: "UNKNOWN_ERROR" })
      }
    },
  })
}
