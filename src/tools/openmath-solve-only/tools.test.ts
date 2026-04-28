/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

import type { ToolContext } from "@opencode-ai/plugin/tool"
import { formatOpenMathArtifactsMarkdown } from "../../openmath/artifacts-markdown/format"
import { hashOpenMathArtifactsMarkdown } from "../../openmath/artifacts-markdown/hash"
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

function createMarkdownArtifacts(problemId: string) {
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

function createJsonArtifacts(problemId: string) {
  return {
    reference_solution: `Solution for ${problemId}.`,
    hint_ladder: {
      L1_nudge: "n",
      L2_key_theorem: "t",
      L3_skeleton: "s",
      L4_full_solution: `Solution for ${problemId}.`,
    },
    grading_rubric: {
      premises_check: ["p"],
      key_theorem: "k",
      key_technique: "m",
      logical_steps: ["l"],
      common_pitfalls: ["c"],
    },
    variant_problem: `Variant for ${problemId}.`,
  }
}

function parseRoundFromDescription(desc: string): number {
  const m = desc.match(/\(round\s+(\d+)\)/)
  return m ? Number(m[1]) : 1
}

function parseProblemIdFromDescription(desc: string): string {
  const m = desc.match(/(solve|review|patch)\s+([^\s]+)\s+\(round/)
  return m ? m[2] : "p"
}

describe("openmath_solve_only tool", () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "openmath-solve-only-test-"))
  })

  afterEach(() => {
    mock.restore()
    rmSync(tempDir, { recursive: true, force: true })
  })

  test("freezes on [CORRECT] in markdown mode and persists __orchestrator_state", async () => {
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
            checks_performed: ["spec"],
            certificate: { artifact_version: "v1", review_round: req.review_round, timestamp: "1970-01-01T00:00:00.000Z", notes: "ok" },
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

    const outRaw = await tool.execute(
      {
        session_id: "root",
        problems: [{ id: "p1", problem: "x+1=2" }],
      },
      mockContext,
    )

    const out = JSON.parse(outRaw as string)
    expect(out.ok).toBe(true)
    expect(out.results[0].id).toBe("p1")
    expect(out.results[0].verdict).toBe("[CORRECT]")
    expect(out.results[0].rounds_used).toBe(1)

    const state = readOpenMathSessionState(tempDir, "root::p1")
    expect(state).not.toBeNull()
    expect(state!.artifact_state).toBe("FROZEN")
    expect(state!.frozen_artifacts).not.toBeNull()

    const hint = state!.frozen_artifacts!.hint_ladder as any
    expect(hint.__orchestrator_state.artifacts_format).toBe("markdown")
    expect(typeof hint.__orchestrator_state.artifacts_markdown).toBe("string")
    expect(typeof hint.__orchestrator_state.artifacts_hash).toBe("string")
  })

  test("continues on [ERROR] then freezes on [CORRECT] (rounds remain sequential per problem)", async () => {
    runSyncImpl = async ({ agentToUse, description, prompt }) => {
      const problemId = parseProblemIdFromDescription(description)
      const round = parseRoundFromDescription(description)

      if (agentToUse === "solver-markdown") {
        return { ok: true, sessionID: `ses_${problemId}_${round}`, text: createMarkdownArtifacts(problemId) }
      }
      if (agentToUse === "solver-markdown-patch") {
        const req = JSON.parse(prompt)
        return {
          ok: true,
          sessionID: `ses_${problemId}_${round}_p`,
          text: JSON.stringify({ base_hash: req.base_hash, ops: [] }),
        }
      }

      if (agentToUse === "reference-reviewer-markdown") {
        const req = JSON.parse(prompt)
        const verdict = req.review_round === 1 ? "[ERROR]" : "[CORRECT]"
        return {
          ok: true,
          sessionID: `ses_${problemId}_${round}_r`,
          text: JSON.stringify({
            verdict,
            blocking_issues:
              req.review_round === 1
                ? [
                    {
                      location: "reference_solution: step 1",
                      type: "logic_error",
                      fix_direction: "Fix the incorrect algebra step.",
                      evidence: "x+1=2 implies x=1.",
                    },
                  ]
                : [],
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
      openmathConfig: { artifacts: { format: "markdown" }, max_review_rounds: 3 },
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

    expect(out.results[0].verdict).toBe("[CORRECT]")
    expect(out.results[0].rounds_used).toBe(2)

    const state = readOpenMathSessionState(tempDir, "root::p1")
    expect(state!.artifact_state).toBe("FROZEN")
    expect(state!.review_round).toBe(2)
  })

  test("runs full markdown patch loop (solve -> review [ERROR] -> patch -> review [CORRECT])", async () => {
    let solverMarkdownCalls = 0
    let solverPatchCalls = 0
    let reviewerCalls = 0
    const callOrder: string[] = []

    runSyncImpl = async ({ agentToUse, description, prompt }) => {
      const problemId = parseProblemIdFromDescription(description)
      const round = parseRoundFromDescription(description)

      if (agentToUse === "solver-markdown") {
        solverMarkdownCalls++
        callOrder.push(`solver-markdown:${round}`)
        if (round !== 1) return { ok: false, error: `unexpected solver-markdown round: ${round}` }
        return { ok: true, sessionID: `ses_${problemId}_${round}`, text: createMarkdownArtifacts(problemId) }
      }

      if (agentToUse === "solver-markdown-patch") {
        solverPatchCalls++
        callOrder.push(`solver-markdown-patch:${round}`)
        if (round !== 2) return { ok: false, error: `unexpected solver-markdown-patch round: ${round}` }

        const req = JSON.parse(prompt)
        expect(req.review_round).toBe(2)
        expect(typeof req.base_hash).toBe("string")
        expect(Array.isArray(req.blocking_issues)).toBe(true)
        expect(req.blocking_issues.length).toBeGreaterThan(0)

        return {
          ok: true,
          sessionID: `ses_${problemId}_${round}_p`,
          text: JSON.stringify({ base_hash: req.base_hash, ops: [] }),
        }
      }

      if (agentToUse === "reference-reviewer-markdown") {
        reviewerCalls++
        callOrder.push(`reference-reviewer-markdown:${round}`)

        const req = JSON.parse(prompt)
        const verdict = req.review_round === 1 ? "[ERROR]" : "[CORRECT]"
        return {
          ok: true,
          sessionID: `ses_${problemId}_${round}_r`,
          text: JSON.stringify({
            verdict,
            blocking_issues:
              verdict === "[ERROR]"
                ? [
                    {
                      location: "reference_solution: step 1",
                      type: "logic_error",
                      fix_direction: "Fix the incorrect algebra step.",
                      evidence: "x+1=2 implies x=1.",
                    },
                  ]
                : [],
            checks_performed: ["logic"],
            certificate: {
              artifact_version: "v1",
              review_round: req.review_round,
              timestamp: "1970-01-01T00:00:00.000Z",
              notes: verdict === "[ERROR]" ? "needs patch" : "ok",
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

    expect(solverMarkdownCalls).toBe(1)
    expect(solverPatchCalls).toBe(1)
    expect(reviewerCalls).toBe(2)
    expect(callOrder).toEqual([
      "solver-markdown:1",
      "reference-reviewer-markdown:1",
      "solver-markdown-patch:2",
      "reference-reviewer-markdown:2",
    ])

    const state = readOpenMathSessionState(tempDir, "root::p1")
    expect(state).not.toBeNull()
    expect(state!.artifact_state).toBe("FROZEN")
    expect(state!.review_round).toBe(2)

    const meta = (state!.frozen_artifacts!.hint_ladder as any).__orchestrator_state
    expect(meta.artifacts_format).toBe("markdown")
    expect(typeof meta.artifacts_markdown).toBe("string")
    expect(typeof meta.artifacts_hash).toBe("string")
  })

  test("[INCONCLUSIVE] transitions to UNFROZEN and clears frozen_artifacts (json mode)", async () => {
    runSyncImpl = async ({ agentToUse, description, prompt }) => {
      const problemId = parseProblemIdFromDescription(description)
      const round = parseRoundFromDescription(description)

      if (agentToUse === "solver") {
        return { ok: true, sessionID: `ses_${problemId}_${round}`, text: JSON.stringify(createJsonArtifacts(problemId)) }
      }
      if (agentToUse === "reference-reviewer") {
        const req = JSON.parse(prompt)
        return {
          ok: true,
          sessionID: `ses_${problemId}_${round}_r`,
          text: JSON.stringify({
            verdict: "[INCONCLUSIVE]",
            blocking_issues: [],
            checks_performed: ["citation"],
            certificate: { artifact_version: "v1", review_round: req.review_round, timestamp: "1970-01-01T00:00:00.000Z", notes: "missing" },
          }),
        }
      }
      return { ok: false, error: `unexpected agent: ${agentToUse}` }
    }

    const tool = createOpenMathSolveOnlyTool({
      directory: tempDir,
      client: {} as any,
      openmathConfig: { artifacts: { format: "json" }, max_review_rounds: 3 },
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

    expect(out.results[0].verdict).toBe("[INCONCLUSIVE]")
    expect(out.results[0].rounds_used).toBe(1)

    const state = readOpenMathSessionState(tempDir, "root::p1")
    expect(state!.artifact_state).toBe("UNFROZEN")
    expect(state!.frozen_artifacts).toBeNull()
  })

  test("uses the lower of args and config concurrency and preserves input order", async () => {
    let active = 0
    let maxActive = 0

    runSyncImpl = async ({ agentToUse, description, prompt }) => {
      active++
      maxActive = Math.max(maxActive, active)
      try {
        await new Promise((r) => setTimeout(r, 25))

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
        solve_only: { max_concurrency: 1 },
      },
    })

    const out = JSON.parse(
      (await tool.execute(
        {
          session_id: "root",
          max_concurrency: 5,
          problems: [
            { id: "p1", problem: "a" },
            { id: "p2", problem: "b" },
            { id: "p3", problem: "c" },
          ],
        },
        mockContext,
      )) as string,
    )

    expect(maxActive).toBe(1)
    expect(out.results.map((r: any) => r.id)).toEqual(["p1", "p2", "p3"])
  })

  test("auto_export writes student/teacher markdown exports after freeze", async () => {
    const exportDir = join(tempDir, "exports")

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
            checks_performed: ["spec"],
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
      openmathConfig: {
        artifacts: { format: "markdown" },
        export: { allowed_base_dirs: [tempDir], overwrite: false },
      },
    })

    const out = JSON.parse(
      (await tool.execute(
        {
          session_id: "root",
          auto_export: true,
          export_dir: exportDir,
          problems: [{ id: "p1", problem: "x+1=2", prefix: "sec77" }],
        },
        mockContext,
      )) as string,
    )

    expect(out.results[0].exported.student_path).toBe(join(exportDir, "sec77_solution_for_student.md"))
    expect(out.results[0].exported.teacher_path).toBe(join(exportDir, "sec77_solution_for_teacher.md"))
    expect(existsSync(out.results[0].exported.student_path)).toBe(true)

    const student = readFileSync(out.results[0].exported.student_path, "utf-8")
    expect(student).toContain("# OpenMath hints (student)")
    expect(student).toContain("## Hint ladder")
  })

  test("patch apply base-hash mismatch fails closed but still allows retry in next round", async () => {
    runSyncImpl = async ({ agentToUse, description, prompt }) => {
      const problemId = parseProblemIdFromDescription(description)
      const round = parseRoundFromDescription(description)

      if (agentToUse === "solver-markdown") {
        return { ok: true, sessionID: `ses_${problemId}_${round}`, text: createMarkdownArtifacts(problemId) }
      }

      if (agentToUse === "reference-reviewer-markdown") {
        const req = JSON.parse(prompt)
        const verdict = req.review_round === 1 ? "[ERROR]" : "[CORRECT]"
        return {
          ok: true,
          sessionID: `ses_${problemId}_${round}_r`,
          text: JSON.stringify({
            verdict,
            blocking_issues:
              verdict === "[ERROR]"
                ? [
                    {
                      location: "reference_solution: step 1",
                      type: "logic_error",
                      fix_direction: "Fix the incorrect algebra step.",
                      evidence: "x+1=2 implies x=1.",
                    },
                  ]
                : [],
            checks_performed: ["spec"],
            certificate: { artifact_version: "v1", review_round: req.review_round, timestamp: "1970-01-01T00:00:00.000Z" },
            base_hash: req.base_hash,
          }),
        }
      }

      if (agentToUse === "solver-markdown-patch") {
        const req = JSON.parse(prompt)
        expect(Array.isArray(req.blocking_issues)).toBe(true)
        expect(req.blocking_issues.length).toBeGreaterThan(0)
        const patchBase = req.review_round === 2 ? "wrong" : req.base_hash
        return { ok: true, sessionID: `ses_${problemId}_${round}_p`, text: JSON.stringify({ base_hash: patchBase, ops: [] }) }
      }

      return { ok: false, error: `unexpected agent: ${agentToUse}` }
    }

    const tool = createOpenMathSolveOnlyTool({
      directory: tempDir,
      client: {} as any,
      openmathConfig: { artifacts: { format: "markdown" }, max_review_rounds: 3 },
    })

    const out = JSON.parse(
      (await tool.execute(
        {
          session_id: "root",
          max_review_rounds: 3,
          problems: [{ id: "p1", problem: "x+1=2" }],
        },
        mockContext,
      )) as string,
    )

    expect(out.results[0].verdict).toBe("[CORRECT]")
    expect(out.results[0].rounds_used).toBe(3)

    const state = readOpenMathSessionState(tempDir, "root::p1")
    expect(state!.artifact_state).toBe("FROZEN")
    const meta = (state!.frozen_artifacts!.hint_ladder as any).__orchestrator_state
    expect(meta.artifacts_hash).toBe(hashOpenMathArtifactsMarkdown(meta.artifacts_markdown))
  })

  test("fails hard when reviewer agent is missing (markdown mode)", async () => {
    runSyncImpl = async ({ agentToUse, description, prompt }) => {
      const problemId = parseProblemIdFromDescription(description)
      const round = parseRoundFromDescription(description)

      if (agentToUse === "solver-markdown") {
        return { ok: true, sessionID: `ses_${problemId}_${round}`, text: createMarkdownArtifacts(problemId) }
      }
      if (agentToUse === "reference-reviewer-markdown") {
        return {
          ok: false,
          error: 'Send prompt to agent failed\n\n**Error**: Agent "reference-reviewer-markdown" not found. Make sure the agent is registered in your opencode.json or provided by a plugin.',
          error_code: "AGENT_NOT_FOUND",
        }
      }
      return { ok: false, error: `unexpected agent: ${agentToUse}` }
    }

    const tool = createOpenMathSolveOnlyTool({
      directory: tempDir,
      client: {} as any,
      openmathConfig: { artifacts: { format: "markdown" }, max_review_rounds: 3 },
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

    expect(out.results[0].verdict).toBe("[ERROR]")
    expect(out.results[0].error_code).toBe("AGENT_NOT_FOUND")
    expect(out.results[0].rounds_used).toBe(1)

    const state = readOpenMathSessionState(tempDir, "root::p1")
    expect(state!.artifact_state).toBe("UNFROZEN")
    expect(state!.frozen_artifacts).toBeNull()
  })

  test("consumes review budget when reviewer output is invalid JSON (markdown mode)", async () => {
    runSyncImpl = async ({ agentToUse, description, prompt }) => {
      const problemId = parseProblemIdFromDescription(description)
      const round = parseRoundFromDescription(description)

      if (agentToUse === "solver-markdown") {
        return { ok: true, sessionID: `ses_${problemId}_${round}`, text: createMarkdownArtifacts(problemId) }
      }
      if (agentToUse === "solver-markdown-patch") {
        const req = JSON.parse(prompt)
        return {
          ok: true,
          sessionID: `ses_${problemId}_${round}_p`,
          text: JSON.stringify({ base_hash: req.base_hash, ops: [] }),
        }
      }
      if (agentToUse === "reference-reviewer-markdown") {
        return { ok: true, sessionID: `ses_${problemId}_${round}_r`, text: "not-json" }
      }
      return { ok: false, error: `unexpected agent: ${agentToUse}` }
    }

    const tool = createOpenMathSolveOnlyTool({
      directory: tempDir,
      client: {} as any,
      openmathConfig: { artifacts: { format: "markdown" }, max_review_rounds: 3 },
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

    expect(out.results[0].verdict).toBe("[ERROR]")
    expect(out.results[0].error_code).toBe("REVIEWER_OUTPUT_INVALID")
    expect(out.results[0].message).toContain("Synthetic reviewer failure")
    expect(out.results[0].message).toContain("candidate_scan")
    expect(out.results[0].rounds_used).toBe(3)
  })

  test("falls back to full regen after 2 consecutive patch failures", async () => {
    let solverMarkdownCalls = 0
    let solverPatchCalls = 0

    runSyncImpl = async ({ agentToUse, description, prompt }) => {
      const problemId = parseProblemIdFromDescription(description)
      const round = parseRoundFromDescription(description)

      if (agentToUse === "solver-markdown") {
        solverMarkdownCalls++
        return { ok: true, sessionID: `ses_${problemId}_${round}`, text: createMarkdownArtifacts(problemId) }
      }

      if (agentToUse === "reference-reviewer-markdown") {
        const req = JSON.parse(prompt)
        const verdict = req.review_round === 4 ? "[CORRECT]" : "[ERROR]"
        return {
          ok: true,
          sessionID: `ses_${problemId}_${round}_r`,
          text: JSON.stringify({
            verdict,
            blocking_issues:
              verdict === "[ERROR]"
                ? [
                    {
                      location: "reference_solution: step 1",
                      type: "logic_error",
                      fix_direction: "Fix the incorrect algebra step.",
                      evidence: "x+1=2 implies x=1.",
                    },
                  ]
                : [],
            checks_performed: ["spec"],
            certificate: { artifact_version: "v1", review_round: req.review_round, timestamp: "1970-01-01T00:00:00.000Z" },
            base_hash: req.base_hash,
          }),
        }
      }

      if (agentToUse === "solver-markdown-patch") {
        solverPatchCalls++
        return { ok: true, sessionID: `ses_${problemId}_${round}_p`, text: "not-json" }
      }

      return { ok: false, error: `unexpected agent: ${agentToUse}` }
    }

    const tool = createOpenMathSolveOnlyTool({
      directory: tempDir,
      client: {} as any,
      openmathConfig: { artifacts: { format: "markdown" }, max_review_rounds: 4 },
    })

    const out = JSON.parse(
      (await tool.execute(
        {
          session_id: "root",
          max_review_rounds: 4,
          problems: [{ id: "p1", problem: "x+1=2" }],
        },
        mockContext,
      )) as string,
    )

    expect(out.results[0].verdict).toBe("[CORRECT]")
    expect(out.results[0].rounds_used).toBe(4)
    expect(solverMarkdownCalls).toBe(2)
    expect(solverPatchCalls).toBe(2)

    const state = readOpenMathSessionState(tempDir, "root::p1")
    const meta = (state!.frozen_artifacts!.hint_ladder as any).__orchestrator_state
    expect(meta.patch_failure_state.consecutive_failures).toBe(0)
  })

  test("allows tuning consecutive patch failures before full regen", async () => {
    let solverMarkdownCalls = 0
    let solverPatchCalls = 0

    runSyncImpl = async ({ agentToUse, description, prompt }) => {
      const problemId = parseProblemIdFromDescription(description)
      const round = parseRoundFromDescription(description)

      if (agentToUse === "solver-markdown") {
        solverMarkdownCalls++
        return { ok: true, sessionID: `ses_${problemId}_${round}`, text: createMarkdownArtifacts(problemId) }
      }

      if (agentToUse === "reference-reviewer-markdown") {
        const req = JSON.parse(prompt)
        const verdict = req.review_round === 5 ? "[CORRECT]" : "[ERROR]"
        return {
          ok: true,
          sessionID: `ses_${problemId}_${round}_r`,
          text: JSON.stringify({
            verdict,
            blocking_issues:
              verdict === "[ERROR]"
                ? [
                    {
                      location: "reference_solution: step 1",
                      type: "logic_error",
                      fix_direction: "Fix the incorrect algebra step.",
                      evidence: "x+1=2 implies x=1.",
                    },
                  ]
                : [],
            checks_performed: ["spec"],
            certificate: { artifact_version: "v1", review_round: req.review_round, timestamp: "1970-01-01T00:00:00.000Z" },
            base_hash: req.base_hash,
          }),
        }
      }

      if (agentToUse === "solver-markdown-patch") {
        solverPatchCalls++
        return { ok: true, sessionID: `ses_${problemId}_${round}_p`, text: "not-json" }
      }

      return { ok: false, error: `unexpected agent: ${agentToUse}` }
    }

    const tool = createOpenMathSolveOnlyTool({
      directory: tempDir,
      client: {} as any,
      openmathConfig: {
        artifacts: { format: "markdown" },
        max_review_rounds: 5,
        max_consecutive_patch_failures: 3,
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

    expect(out.results[0].verdict).toBe("[CORRECT]")
    expect(out.results[0].rounds_used).toBe(5)
    expect(solverMarkdownCalls).toBe(2)
    expect(solverPatchCalls).toBe(3)
  })

  test("persists solve-only state in windows filename mode", async () => {
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
            checks_performed: ["spec"],
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
      openmathConfig: {
        max_review_rounds: 3,
        artifacts: { format: "markdown" },
        state_filename_mode: "windows",
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
    expect(readOpenMathSessionState(tempDir, "root::p1", "windows")?.artifact_state).toBe("FROZEN")
    expect(readOpenMathSessionState(tempDir, "root::p1", "linux")?.artifact_state).toBe("FROZEN")
  })
})
