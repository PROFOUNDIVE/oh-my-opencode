/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { ToolContext } from "@opencode-ai/plugin/tool"
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

function parseRoundFromDescription(desc: string): number {
  const match = desc.match(/\(round\s+(\d+)\)/)
  return match ? Number(match[1]) : 1
}

function parseProblemIdFromDescription(desc: string): string {
  const match = desc.match(/(solve|review|patch)\s+([^\s]+)\s+\(round/)
  return match ? match[2] : "p"
}

function createMarkdownArtifacts(problemId: string) {
  return [
    "# Reference Solution",
    `Solution for ${problemId}.`,
    "",
    "# Hint Ladder",
    "- L1_nudge: n",
    "- L2_key_theorem: t",
    "- L3_skeleton:",
    "  - s1",
    "- L4_full_solution: @REFERENCE_SOLUTION",
    "",
    "# Grading Rubric",
    "- premises_check:",
    "  - p",
    "- logical_steps:",
    "  - l",
    "- common_pitfalls:",
    "  - c",
    "- key_theorem: k",
    "- key_technique: m",
    "",
    "# Variant Problem",
    `Variant for ${problemId}.`,
  ].join("\n")
}

describe("openmath_solve_only limits", () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "openmath-solve-only-limits-"))
  })

  afterEach(() => {
    mock.restore()
    rmSync(tempDir, { recursive: true, force: true })
  })

  test("preserves max_review_rounds above 20 in persisted state", async () => {
    runSyncImpl = async ({ agentToUse, description, prompt }) => {
      const problemId = parseProblemIdFromDescription(description)
      const round = parseRoundFromDescription(description)

      if (agentToUse === "solver-markdown") {
        return { ok: true, sessionID: `ses_${problemId}_${round}`, text: createMarkdownArtifacts(problemId) }
      }

      if (agentToUse === "reference-reviewer-markdown") {
        const req = JSON.parse(prompt)
        return {
          ok: true,
          sessionID: `ses_${problemId}_${round}_r`,
          text: JSON.stringify({
            verdict: "[CORRECT]",
            blocking_issues: [],
            checks_performed: ["logic"],
            certificate: { artifact_version: "v1", review_round: req.review_round, timestamp: "1970-01-01T00:00:00.000Z" },
            base_hash: req.base_hash,
          }),
        }
      }

      return { ok: false, error: `unexpected agent: ${agentToUse}` }
    }

    const tool = createOpenMathSolveOnlyTool({
      directory: tempDir,
      client: {} as any,
      openmathConfig: { artifacts: { format: "markdown" } },
    })

    const result = JSON.parse(
      (await tool.execute(
        {
          session_id: "root",
          max_review_rounds: 21,
          problems: [{ id: "p1", problem: "x+1=2" }],
        },
        mockContext,
      )) as string,
    )

    expect(result.ok).toBe(true)

    const state = readOpenMathSessionState(tempDir, "root::p1")
    expect(state).not.toBeNull()
    expect(state!.max_review_rounds).toBe(21)
  })

  test("does not clamp max_concurrency to 20", async () => {
    let active = 0
    let maxActive = 0

    runSyncImpl = async ({ agentToUse, description, prompt }) => {
      active++
      maxActive = Math.max(maxActive, active)

      try {
        await new Promise((resolve) => setTimeout(resolve, 25))
        const problemId = parseProblemIdFromDescription(description)
        const round = parseRoundFromDescription(description)

        if (agentToUse === "solver-markdown") {
          return { ok: true, sessionID: `ses_${problemId}_${round}`, text: createMarkdownArtifacts(problemId) }
        }

        if (agentToUse === "reference-reviewer-markdown") {
          const req = JSON.parse(prompt)
          return {
            ok: true,
            sessionID: `ses_${problemId}_${round}_r`,
            text: JSON.stringify({
              verdict: "[CORRECT]",
              blocking_issues: [],
              checks_performed: ["logic"],
              certificate: { artifact_version: "v1", review_round: req.review_round, timestamp: "1970-01-01T00:00:00.000Z" },
              base_hash: req.base_hash,
            }),
          }
        }

        return { ok: false, error: `unexpected agent: ${agentToUse}` }
      } finally {
        active--
      }
    }

    const tool = createOpenMathSolveOnlyTool({
      directory: tempDir,
      client: {} as any,
      openmathConfig: {
        artifacts: { format: "markdown" },
        solve_only: { max_concurrency: 25 },
      },
    })

    const problems = Array.from({ length: 21 }, (_, index) => ({
      id: `p${index + 1}`,
      problem: `problem-${index + 1}`,
    }))

    const result = JSON.parse(
      (await tool.execute(
        {
          session_id: "root",
          max_concurrency: 25,
          problems,
        },
        mockContext,
      )) as string,
    )

    expect(result.ok).toBe(true)
    expect(maxActive).toBeGreaterThan(20)
    expect(result.results).toHaveLength(21)
  })
})
