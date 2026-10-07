/// <reference types="bun-types" />

import { expect, spyOn, test } from "bun:test"
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import { createOpencodeClient } from "@opencode-ai/sdk"

import { OpenMathConfigSchema } from "../config/schema"
import { formatOpenMathArtifactsMarkdown } from "../openmath/artifacts-markdown/format"
import { nodeStorageRuntime } from "../openmath/workflow/storage/node-storage-runtime"
import { getOpenMathStorageDirectory } from "../openmath/storage-directory"
import { readWorkflowState, startWorkflowState } from "../openmath/workflow/storage"
import { createStoredWorkflowState } from "../openmath/workflow/storage/storage-test-state"
import { createWorkflowStageRuntime } from "../openmath/workflow/stage-runner"
import { readOpenMathSessionState, writeOpenMathSessionState } from "../openmath/storage"
import { runLegacyWorkflow } from "./openmath-solve-only/run-legacy-workflow"
import { createOpenMathSolveOnlyTool } from "./openmath-solve-only/tools"
import { createOpenMathWorkflowStatusTool } from "./openmath-workflow-status"
import * as dispatch from "./openmath-solve-only/run-sync-subagent"

test("solves, resumes and exports with local storage while project hard links fail", async () => {
  // given
  const sandbox = mkdtempSync(join(tmpdir(), "openmath-local-solve-"))
  const project = join(sandbox, "cloud-project")
  mkdirSync(project)
  writeFileSync(join(project, "problem.md"), "1. Prove that 1 = 1.\n")
  const config = OpenMathConfigSchema.parse({ storage_root: join(sandbox, "local-state"), state_filename_mode: "windows" })
  const server = Bun.serve({ port: 0, fetch: () => Response.json([]) })
  const client = createOpencodeClient({ baseUrl: `http://127.0.0.1:${server.port}` })
  const context = { sessionID: "local-solve-parent", messageID: "message", agent: "test", abort: new AbortController().signal }
  const originalLink = nodeStorageRuntime.link
  const linkSpy = spyOn(nodeStorageRuntime, "link").mockImplementation(async (source, destination) => {
    if (!relative(project, source).startsWith("..")) {
      throw Object.assign(new Error("Hard links are unavailable"), { code: "EISDIR" })
    }
    await originalLink(source, destination)
  })
  const dispatchSpy = spyOn(dispatch, "runSyncSubagentText").mockImplementation(async (input) => {
    expect(input.directory).toBe(project)
    const text = input.agentToUse === "solver-markdown"
      ? formatOpenMathArtifactsMarkdown({
          reference_solution: "Equality is reflexive.",
          hint_ladder: { L1_nudge: "Use equality.", L2_key_theorem: "Reflexivity", L3_skeleton: ["Apply reflexivity."], L4_full_solution: "@REFERENCE_SOLUTION" },
          grading_rubric: { premises_check: ["Equality is defined."], logical_steps: ["Apply reflexivity."], common_pitfalls: ["None"], key_theorem: "Reflexivity", key_technique: "Apply the axiom." },
          variant_problem: "Prove that 2 = 2.",
        })
      : JSON.stringify({
          verdict: "[CORRECT]", blocking_issues: [], checks_performed: ["reflexivity"],
          certificate: { artifact_version: "v1", review_round: 1, timestamp: "1970-01-01T00:00:00.000Z", notes: "Checked." },
          base_hash: JSON.parse(input.prompt).base_hash,
        })
    return { ok: true, sessionID: `child-${input.agentToUse}`, text }
  })
  try {
    const args = { session_id: "APT_MIDTERM", problems: [{ id: "1", problem_ref: { file_path: "@[problem.md]", problem_number: 1 } }], auto_export: true, export_dir: "./exports" }

    // when
    const result = JSON.parse(await createOpenMathSolveOnlyTool({ directory: project, client, openmathConfig: config }).execute(args, context))
    const resumed = JSON.parse(await createOpenMathSolveOnlyTool({ directory: project, client, openmathConfig: config }).execute({ ...args, auto_export: false }, context))
    const status = JSON.parse(await createOpenMathWorkflowStatusTool({ directory: project, openmathConfig: config }).execute({ run_id: "APT_MIDTERM::1" }, context))
    const projectStateWasAbsent = !existsSync(join(project, ".sisyphus"))
    const storageDirectory = getOpenMathStorageDirectory(project, config.storage_root)
    const frozen = readOpenMathSessionState(storageDirectory, "APT_MIDTERM::1", "windows")
    if (!frozen?.frozen_artifacts) throw new TypeError("Expected the local frozen projection")
    writeOpenMathSessionState(project, {
      ...frozen,
      frozen_artifacts: { ...frozen.frozen_artifacts, reference_solution: "Stale project solution." },
    }, "windows")
    const explicit = await runLegacyWorkflow({
      directory: project, storageDirectory, client, ctx: context,
      config: { state_filename_mode: "windows", artifacts: { format: "markdown" } },
      rootSessionId: "APT_MIDTERM", problem: { id: "1", problem: "Prove that 1 = 1." },
      maxReviewRounds: 3, maxConsecutivePatchFailures: 2, autoExport: true, exportDir: "./explicit-exports",
    })

    // then
    expect(result.results[0]).toMatchObject({ verdict: "[CORRECT]", rounds_used: 1 })
    expect(resumed.results[0]).toMatchObject({ verdict: "[CORRECT]", rounds_used: 1 })
    expect(dispatchSpy).toHaveBeenCalledTimes(2)
    expect(status).toMatchObject({ ok: true, status: "PASSED" })
    expect(result.results[0].exported.teacher_path).toBe(join(project, "exports", "1_solution_for_teacher.md"))
    expect(readFileSync(result.results[0].exported.teacher_path, "utf8")).toContain("Equality is reflexive.")
    expect(projectStateWasAbsent).toBe(true)
    if (!explicit.exported) throw new TypeError("Expected export from the explicit local store")
    expect(readFileSync(explicit.exported.teacher_path, "utf8")).toContain("Equality is reflexive.")
    expect(readFileSync(explicit.exported.teacher_path, "utf8")).not.toContain("Stale project solution.")
  } finally {
    dispatchSpy.mockRestore()
    linkSpy.mockRestore()
    server.stop(true)
    rmSync(sandbox, { recursive: true, force: true })
  }
})

test("persists workflow stages locally while querying OpenCode in the project directory", async () => {
  // given
  const sandbox = mkdtempSync(join(tmpdir(), "openmath-local-runtime-"))
  const project = join(sandbox, "project")
  mkdirSync(project)
  const storageDirectory = getOpenMathStorageDirectory(project, join(sandbox, "state"))
  const state = createStoredWorkflowState("local-runtime", 0)
  const queriedDirectories: Array<string | null> = []
  const server = Bun.serve({ port: 0, fetch: (request) => {
    queriedDirectories.push(new URL(request.url).searchParams.get("directory"))
    return Response.json([])
  } })
  const client = createOpencodeClient({ baseUrl: `http://127.0.0.1:${server.port}` })
  const ctx = { sessionID: "parent", messageID: "message", agent: "test", abort: new AbortController().signal }
  try {
    const started = await startWorkflowState({ directory: storageDirectory, state })
    expect(started.kind).toBe("ok")
    const runtime = createWorkflowStageRuntime({ directory: project, storageDirectory, state, client, ctx })

    // when
    const persisted = await runtime.persist(state)
    await runtime.list_children("parent")

    // then
    expect(persisted.state_revision).toBe(1)
    expect(await readWorkflowState(storageDirectory, state.run_id)).toMatchObject({ kind: "ok", state: { state_revision: 1 } })
    expect(queriedDirectories).toEqual([project])
    expect(existsSync(join(project, ".sisyphus"))).toBe(false)
  } finally {
    server.stop(true)
    rmSync(sandbox, { recursive: true, force: true })
  }
})
