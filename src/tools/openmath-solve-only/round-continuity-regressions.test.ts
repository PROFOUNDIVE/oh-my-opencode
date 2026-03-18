import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

import type { ToolContext } from "@opencode-ai/plugin/tool"
import { formatOpenMathArtifactsMarkdown } from "../../openmath/artifacts-markdown/format"
import { readOpenMathSessionState } from "../../openmath/storage"

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

describe("openmath_solve_only continuity regressions", () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "openmath-solve-only-continuity-test-"))
  })

  afterEach(() => {
    mock.restore()
    rmSync(tempDir, { recursive: true, force: true })
  })

  test("reuses solver-markdown-patch after repeated reviewer errors", async () => {
    const callOrder: string[] = []
    const patchRequests: Array<{ round: number; base_hash: string; blocking_issues_count: number }> = []

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
        expect(req.review_round).toBe(round)
        expect(typeof req.base_hash).toBe("string")
        expect(req.base_hash.length).toBeGreaterThan(0)
        expect(Array.isArray(req.blocking_issues)).toBe(true)
        expect(req.blocking_issues.length).toBeGreaterThan(0)
        patchRequests.push({
          round,
          base_hash: req.base_hash,
          blocking_issues_count: req.blocking_issues.length,
        })

        return {
          ok: true,
          sessionID: `ses_${problemId}_${round}_p`,
          text: JSON.stringify({ base_hash: req.base_hash, ops: [] }),
        }
      }

      if (agentToUse === "reference-reviewer-markdown") {
        callOrder.push(`reference-reviewer-markdown:${round}`)
        const req = JSON.parse(prompt)
        const verdict = req.review_round < 3 ? "[ERROR]" : "[CORRECT]"
        return {
          ok: true,
          sessionID: `ses_${problemId}_${round}_r`,
          text: JSON.stringify({
            verdict,
            blocking_issues:
              verdict === "[ERROR]"
                ? [
                    {
                      location: `reference_solution: round ${round}`,
                      type: "logic_error",
                      fix_direction: "tighten derivation",
                      evidence: "mismatch in intermediate algebra",
                    },
                  ]
                : [],
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
    expect(out.results[0].rounds_used).toBe(3)
    expect(callOrder).toEqual([
      "solver-markdown:1",
      "reference-reviewer-markdown:1",
      "solver-markdown-patch:2",
      "reference-reviewer-markdown:2",
      "solver-markdown-patch:3",
      "reference-reviewer-markdown:3",
    ])
    expect(patchRequests).toEqual([
      { round: 2, base_hash: patchRequests[0]?.base_hash, blocking_issues_count: 1 },
      { round: 3, base_hash: patchRequests[0]?.base_hash, blocking_issues_count: 1 },
    ])

    const state = readOpenMathSessionState(tempDir, "root::p1")
    expect(state).not.toBeNull()
    expect(state!.artifact_state).toBe("FROZEN")
    expect(state!.review_round).toBe(3)
    const meta = (state!.frozen_artifacts!.hint_ladder as any).__orchestrator_state
    expect(meta.artifacts_format).toBe("markdown")
    expect(typeof meta.artifacts_markdown).toBe("string")
    expect(typeof meta.artifacts_hash).toBe("string")
  })
})
