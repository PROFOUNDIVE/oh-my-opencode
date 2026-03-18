import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

import type { ToolContext } from "@opencode-ai/plugin/tool"
import { formatOpenMathArtifactsMarkdown } from "../../openmath/artifacts-markdown/format"

let runSyncImpl: (args: any) => Promise<
  { ok: true; sessionID: string; text: string } | { ok: false; error: string; error_code?: string }
>

mock.module("./run-sync-subagent", () => ({
  runSyncSubagentText: (args: any) => runSyncImpl(args),
}))

import { createOpenMathSolveOnlyTool } from "./tools"

const mockContext = {
  sessionID: "opencode-parent-session",
  messageID: "test-message",
  agent: "test-agent",
  abort: new AbortController().signal,
  metadata: () => {},
  ask: async () => {},
} as unknown as ToolContext

function createMarkdownArtifacts(problemId: string): string {
  return formatOpenMathArtifactsMarkdown({
    reference_solution: `Solution for ${problemId}.`,
    hint_ladder: {
      L1_nudge: "n",
      L2_key_theorem: "t",
      L3_skeleton: ["s1"],
      L4_full_solution: "@REFERENCE_SOLUTION",
    },
    grading_rubric: {
      premises_check: ["p"],
      logical_steps: ["l"],
      common_pitfalls: ["c"],
      key_theorem: "k",
      key_technique: "m",
    },
    variant_problem: `Variant for ${problemId}.`,
  })
}

function parseRoundFromDescription(desc: string): number {
  const m = desc.match(/\(round\s+(\d+)\)/)
  return m ? Number(m[1]) : 1
}

function parseProblemIdFromDescription(desc: string): string {
  const m = desc.match(/(solve|review|patch)\s+([^\s]+)\s+\(round/)
  return m ? m[2] : "p"
}

describe("openmath_solve_only retry budget policy", () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "openmath-solve-only-retry-budget-test-"))
  })

  afterEach(() => {
    mock.restore()
    rmSync(tempDir, { recursive: true, force: true })
  })

  test("continues after malformed reviewer output until budget is exhausted", async () => {
    const callOrder: string[] = []

    runSyncImpl = async ({ agentToUse, description, prompt }) => {
      const problemId = parseProblemIdFromDescription(description)
      const round = parseRoundFromDescription(description)

      if (agentToUse === "solver-markdown") {
        callOrder.push(`solver-markdown:${round}`)
        return { ok: true, sessionID: `ses_${problemId}_${round}_s`, text: createMarkdownArtifacts(problemId) }
      }

      if (agentToUse === "solver-markdown-patch") {
        callOrder.push(`solver-markdown-patch:${round}`)
        const req = JSON.parse(prompt)
        return {
          ok: true,
          sessionID: `ses_${problemId}_${round}_p`,
          text: JSON.stringify({ base_hash: req.base_hash, ops: [] }),
        }
      }

      if (agentToUse === "reference-reviewer-markdown") {
        callOrder.push(`reference-reviewer-markdown:${round}`)
        const req = JSON.parse(prompt)
        if (req.review_round === 1) {
          return {
            ok: true,
            sessionID: `ses_${problemId}_${round}_r`,
            text: "{not-json",
          }
        }

        return {
          ok: true,
          sessionID: `ses_${problemId}_${round}_r`,
          text: JSON.stringify({
            verdict: "[CORRECT]",
            blocking_issues: [],
            checks_performed: ["logic"],
            certificate: {
              artifact_version: "v1",
              review_round: req.review_round,
              timestamp: "1970-01-01T00:00:00.000Z",
            },
            base_hash: req.base_hash,
          }),
        }
      }

      return { ok: false, error: `unexpected agent: ${agentToUse}` }
    }

    const tool = createOpenMathSolveOnlyTool({
      directory: tempDir,
      client: {} as any,
      openmathConfig: {
        max_review_rounds: 3,
        artifacts: { format: "markdown" },
      },
    })

    const out = JSON.parse(
      (await tool.execute(
        {
          session_id: "root",
          problems: [{ id: "p1", problem: "x+1=2" }],
        },
        mockContext,
      )) as string,
    )

    expect(out.ok).toBe(true)
    expect(out.results[0].verdict).toBe("[CORRECT]")
    expect(out.results[0].rounds_used).toBe(2)
    expect(callOrder).toEqual([
      "solver-markdown:1",
      "reference-reviewer-markdown:1",
      "solver-markdown-patch:2",
      "reference-reviewer-markdown:2",
    ])
  })

  test("continues after malformed solver markdown output until a later round succeeds", async () => {
    const callOrder: string[] = []

    runSyncImpl = async ({ agentToUse, description, prompt }) => {
      const problemId = parseProblemIdFromDescription(description)
      const round = parseRoundFromDescription(description)

      if (agentToUse === "solver-markdown") {
        callOrder.push(`solver-markdown:${round}`)
        if (round === 1) {
          return { ok: true, sessionID: `ses_${problemId}_${round}_s`, text: "not-omo-markdown" }
        }
        return { ok: true, sessionID: `ses_${problemId}_${round}_s`, text: createMarkdownArtifacts(problemId) }
      }

      if (agentToUse === "reference-reviewer-markdown") {
        callOrder.push(`reference-reviewer-markdown:${round}`)
        const req = JSON.parse(prompt)
        return {
          ok: true,
          sessionID: `ses_${problemId}_${round}_r`,
          text: JSON.stringify({
            verdict: "[CORRECT]",
            blocking_issues: [],
            checks_performed: ["logic"],
            certificate: {
              artifact_version: "v1",
              review_round: req.review_round,
              timestamp: "1970-01-01T00:00:00.000Z",
            },
            base_hash: req.base_hash,
          }),
        }
      }

      return { ok: false, error: `unexpected agent: ${agentToUse}` }
    }

    const tool = createOpenMathSolveOnlyTool({
      directory: tempDir,
      client: {} as any,
      openmathConfig: {
        max_review_rounds: 3,
        artifacts: { format: "markdown" },
      },
    })

    const out = JSON.parse(
      (await tool.execute(
        {
          session_id: "root",
          problems: [{ id: "p1", problem: "x+1=2" }],
        },
        mockContext,
      )) as string,
    )

    expect(out.ok).toBe(true)
    expect(out.results[0].verdict).toBe("[CORRECT]")
    expect(out.results[0].rounds_used).toBe(2)
    expect(callOrder).toEqual([
      "solver-markdown:1",
      "solver-markdown:2",
      "reference-reviewer-markdown:2",
    ])
  })

  test("does not execute round N+1 after retry budget is exhausted", async () => {
    const solverRounds: number[] = []

    runSyncImpl = async ({ agentToUse, description }) => {
      const problemId = parseProblemIdFromDescription(description)
      const round = parseRoundFromDescription(description)

      if (agentToUse === "solver-markdown") {
        solverRounds.push(round)
        return { ok: true, sessionID: `ses_${problemId}_${round}_s`, text: "not-omo-markdown" }
      }

      return { ok: false, error: `unexpected agent: ${agentToUse}` }
    }

    const tool = createOpenMathSolveOnlyTool({
      directory: tempDir,
      client: {} as any,
      openmathConfig: {
        max_review_rounds: 2,
        artifacts: { format: "markdown" },
      },
    })

    const out = JSON.parse(
      (await tool.execute(
        {
          session_id: "root",
          max_review_rounds: 2,
          problems: [{ id: "p1", problem: "x+1=2" }],
        },
        mockContext,
      )) as string,
    )

    expect(out.ok).toBe(true)
    expect(out.results[0].verdict).toBe("[ERROR]")
    expect(out.results[0].error_code).toBe("ARTIFACTS_PARSE_ERROR")
    expect(out.results[0].rounds_used).toBe(2)
    expect(solverRounds).toEqual([1, 2])
  })

  test("keeps AGENT_NOT_FOUND fatal", async () => {
    runSyncImpl = async ({ agentToUse }) => {
      if (agentToUse === "solver-markdown") {
        return { ok: false, error: 'Agent "solver-markdown" not found', error_code: "AGENT_NOT_FOUND" }
      }
      return { ok: false, error: `unexpected agent: ${agentToUse}` }
    }

    const tool = createOpenMathSolveOnlyTool({
      directory: tempDir,
      client: {} as any,
      openmathConfig: {
        max_review_rounds: 3,
        artifacts: { format: "markdown" },
      },
    })

    const out = JSON.parse(
      (await tool.execute(
        {
          session_id: "root",
          problems: [{ id: "p1", problem: "x+1=2" }],
        },
        mockContext,
      )) as string,
    )

    expect(out.ok).toBe(true)
    expect(out.results[0].verdict).toBe("[ERROR]")
    expect(out.results[0].error_code).toBe("AGENT_NOT_FOUND")
    expect(out.results[0].rounds_used).toBe(1)
  })
})
