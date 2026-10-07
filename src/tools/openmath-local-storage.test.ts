/// <reference types="bun-types" />

import { afterEach, beforeEach, expect, spyOn, test } from "bun:test"
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"

import { OpenMathConfigSchema } from "../config/schema"
import { nodeStorageRuntime } from "../openmath/workflow/storage/node-storage-runtime"
import { createOpenMathWorkflowStartTool } from "./openmath-workflow-start"
import { createOpenMathWorkflowStatusTool } from "./openmath-workflow-status"
import { createOpenMathWorkflowAmendTool } from "./openmath-workflow-amend"
import type { OpenMathWorkflowToolOptions } from "./openmath-workflow-shared"

const context = { sessionID: "local-storage-parent", messageID: "message", agent: "test", abort: new AbortController().signal }
let sandbox: string
let project: string
let localRoot: string

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "openmath-local-storage-"))
  project = join(sandbox, "cloud-project")
  localRoot = join(sandbox, "local-state")
  mkdirSync(project)
})

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true })
})

function options(directory: string, storageRoot: string): OpenMathWorkflowToolOptions {
  return {
    directory,
    openmathConfig: OpenMathConfigSchema.parse({
      storage_root: storageRoot,
      default_workflow_profile: "local-profile",
      workflow_profiles: {
        "local-profile": {
          solve: { agent: "solver", model: "openai/solver", prompt: { kind: "inline", content: "Solve" }, output_adapter: "opaque_markdown" },
          review: { agent: "reviewer", model: "openai/reviewer", prompt: { kind: "inline", content: "Review" }, output_adapter: "review_verdict_markdown" },
          revise: { agent: "reviser", model: "openai/reviser", prompt: { kind: "inline", content: "Revise" }, output_adapter: "full_replace_markdown" },
          min_review_rounds: 1,
          max_review_rounds: 2,
          required_consecutive_passes: 1,
          checkpoint: "none",
        },
      },
    }),
  }
}

test("starts and resumes local revisions while reading sources from a hard-link-free project", async () => {
  // given
  writeFileSync(join(project, "problem.md"), "1. Prove that 1 = 1.\n")
  const originalLink = nodeStorageRuntime.link
  const linkSpy = spyOn(nodeStorageRuntime, "link").mockImplementation(async (source, destination) => {
    if (!relative(project, source).startsWith("..")) {
      throw Object.assign(new Error("Hard links are unavailable"), { code: "EISDIR", errno: -4068, syscall: "link" })
    }
    await originalLink(source, destination)
  })
  try {
    const configured = options(project, localRoot)

    // when
    const started = JSON.parse(await createOpenMathWorkflowStartTool(configured).execute({
      run_id: "cloud-run",
      request: { kind: "problem", source: { kind: "file", file_path: "@[problem.md]", problem_number: 1 } },
    }, context))
    const reported = JSON.parse(await createOpenMathWorkflowStatusTool(options(project, localRoot)).execute({ run_id: "cloud-run" }, context))
    const amended = JSON.parse(await createOpenMathWorkflowAmendTool(options(project, localRoot)).execute({
      run_id: "cloud-run", expected_state_revision: 0, operation: "add", kind: "required_check", scope: "next_review", content: "Check the equality.",
    }, context))

    // then
    expect(started).toMatchObject({ ok: true, state_revision: 0 })
    expect(reported).toMatchObject({ ok: true, state_revision: 0 })
    expect(amended).toMatchObject({ ok: true, state_revision: 1 })
    expect(existsSync(join(project, ".sisyphus", "openmath-workflows"))).toBe(false)
    const revisions = readdirSync(localRoot, { recursive: true, encoding: "utf8" }).filter((name) => name.endsWith(".json"))
    expect(revisions).toHaveLength(2)
    const stored = JSON.parse(readFileSync(join(localRoot, revisions[0] ?? "missing"), "utf8"))
    expect(stored.request_snapshot.problem_text).toContain("Prove that 1 = 1.")
  } finally {
    linkSpy.mockRestore()
  }
})

test("isolates concurrent projects sharing a local storage root and run id", async () => {
  // given
  const secondProject = join(sandbox, "second-project")
  mkdirSync(secondProject)
  const first = options(project, localRoot)
  const second = options(secondProject, localRoot)

  // when
  const results = await Promise.all([first, second].map(async (configured) => JSON.parse(await createOpenMathWorkflowStartTool(configured).execute({
    run_id: "same-run", request: { kind: "markdown", instruction: configured.directory },
  }, context))))
  const reports = await Promise.all([first, second].map(async (configured) => JSON.parse(await createOpenMathWorkflowStatusTool(configured).execute({ run_id: "same-run" }, context))))

  // then
  expect(results).toEqual([expect.objectContaining({ ok: true }), expect.objectContaining({ ok: true })])
  expect(reports).toEqual([expect.objectContaining({ ok: true }), expect.objectContaining({ ok: true })])
  expect(existsSync(localRoot)).toBe(true)
  const revisions = readdirSync(localRoot, { recursive: true, encoding: "utf8" }).filter((name) => name.endsWith(".json"))
  expect(revisions).toHaveLength(2)
  expect(revisions.map((path) => JSON.parse(readFileSync(join(localRoot, path), "utf8")).request_snapshot.instruction).sort()).toEqual([project, secondProject].sort())
})

test("reserves one authoritative run when local-store starts contend", async () => {
  // given
  const configured = options(project, localRoot)
  const request = { run_id: "contended", request: { kind: "markdown", instruction: "Prove it." } }

  // when
  const results = await Promise.all([0, 1].map(async () => JSON.parse(await createOpenMathWorkflowStartTool(configured).execute(request, context))))

  // then
  expect(results.filter((result) => result.ok)).toHaveLength(1)
  expect(results.filter((result) => !result.ok)).toEqual([expect.objectContaining({ error_code: "RUN_ALREADY_EXISTS" })])
  expect(readdirSync(localRoot, { recursive: true, encoding: "utf8" }).filter((name) => name.endsWith(".json"))).toHaveLength(1)
})

test("fails closed when the configured local store also rejects hard links", async () => {
  // given
  const originalLink = nodeStorageRuntime.link
  const linkSpy = spyOn(nodeStorageRuntime, "link").mockImplementation(async (source, destination) => {
    if (!relative(localRoot, source).startsWith("..")) {
      throw Object.assign(new Error("Configured storage lacks hard links"), { code: "EISDIR" })
    }
    await originalLink(source, destination)
  })
  try {
    // when
    const result = JSON.parse(await createOpenMathWorkflowStartTool(options(project, localRoot)).execute({
      run_id: "unsupported-store", request: { kind: "markdown", instruction: "Prove it." },
    }, context))

    // then
    expect(result).toMatchObject({ ok: false, error_code: "STORAGE_ATOMICITY_UNAVAILABLE" })
    expect(existsSync(join(project, ".sisyphus"))).toBe(false)
    expect(readdirSync(localRoot, { recursive: true, encoding: "utf8" }).filter((name) => name.endsWith(".json"))).toEqual([])
  } finally {
    linkSpy.mockRestore()
  }
})
