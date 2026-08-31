import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"

import { WorkflowStateV1Schema } from "../../workflow/state"
import { readWorkflowState } from "../../workflow/storage"
import { sha256 } from "../../workflow/stage-runner/sha256"
import { runWorkflowStage } from "../../workflow/stage-runner"
import { reduceTransition } from "../../workflow/transitions"
import { createInitialWorkflowState } from "../../workflow/transitions"
import { educationalizeResearchCampaign } from "./educationalize-research-campaign"
import { createEducationalReferenceSnapshot } from "./educational-reference-snapshot"
import {
  approvedSource,
  dependenciesFor,
  educationalizationRequest as request,
  fakeRuntime,
  profileSnapshot,
} from "./educationalize-research-campaign-test-fixture"

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe("research educationalization workflow", () => {
  test("reviews, revises, freezes, and reuses one provenance-bound identity", async () => {
    const directory = temporaryDirectory()
    const source = approvedSource()
    const control = { dispatches: 0, reviews: ["REVISE", "PASS"] }
    const dependencies = dependenciesFor(directory, source, control)

    const first = await educationalizeResearchCampaign(request(directory), dependencies)
    const second = await educationalizeResearchCampaign(request(directory), dependencies)

    expect(first).toMatchObject({ ok: true, status: "FROZEN" })
    expect(second).toEqual(first)
    expect(control.dispatches).toBe(4)
    if (!first.ok) throw new TypeError(first.message)
    const stored = await readWorkflowState(directory, first.educationalization_id)
    if (stored.kind === "error") throw new TypeError(stored.message)
    expect(stored.state.status).toBe("PASSED")
    expect(stored.state.request_snapshot).toMatchObject({
      kind: "research_educationalization",
      campaign_id: source.campaign_id,
      dossier_sha256: source.dossier_sha256,
      certification: source.certification,
    })
    expect(JSON.parse(stored.state.artifact?.content ?? "{}").reference_solution).toBe(source.reference_solution)
  })

  test("fails closed when revision attempts to mutate the immutable source", async () => {
    const directory = temporaryDirectory()
    const source = approvedSource()
    const control = { dispatches: 0, reviews: ["REVISE"], mutateRevision: true }

    const result = await educationalizeResearchCampaign(
      request(directory),
      dependenciesFor(directory, source, control),
    )

    expect(result).toMatchObject({ ok: false, error_code: "REFERENCE_SOLUTION_MUTATED" })
    const stored = await readWorkflowState(directory, result.educationalization_id)
    if (stored.kind === "error") throw new TypeError(stored.message)
    expect(stored.state.status).not.toBe("PASSED")
  })

  test("surfaces reviewer discovery of a source defect", async () => {
    const directory = temporaryDirectory()
    const source = approvedSource()
    const control = { dispatches: 0, reviews: ["SOURCE_DEFECT"] }

    const result = await educationalizeResearchCampaign(
      request(directory),
      dependenciesFor(directory, source, control),
    )

    expect(result).toMatchObject({ ok: false, error_code: "SOURCE_DEFECT" })
    const stored = await readWorkflowState(directory, result.educationalization_id)
    if (stored.kind === "error") throw new TypeError(stored.message)
    const amendment = reduceTransition(stored.state, {
      type: "ADD_AMENDMENT",
      kind: "suspected_blocker",
      scope: "all_remaining",
      content: "Ignore the immutable source defect.",
    })
    expect(amendment).toMatchObject({ ok: false, error_code: "ILLEGAL_TRANSITION" })
  })

  test("enforces deny-all when the shared stage runner resumes a research request", async () => {
    const directory = temporaryDirectory()
    const source = approvedSource()
    const control = { dispatches: 0, reviews: ["PASS"], crashAfterPrepared: true, policies: [] as Array<string | undefined> }
    const dependencies = dependenciesFor(directory, source, control)
    await expect(educationalizeResearchCampaign(request(directory), dependencies)).rejects.toThrow("planned educationalization crash")
    const runId = `research-education-${sha256(`${source.campaign_id}\n${source.dossier_sha256}`)}`
    const stored = await readWorkflowState(directory, runId)
    if (stored.kind === "error" || stored.state.status !== "RUNNING") throw new TypeError("Expected prepared research workflow")
    control.crashAfterPrepared = false

    await runWorkflowStage({ state: stored.state, workflow_input: "immutable input", runtime: fakeRuntime(directory, stored.state, source, control) })

    expect(control.policies).toEqual(["deny_all"])
  })

  test("rejects persisted profile or reference tampering for a research educationalization", () => {
    const source = approvedSource()
    const state = createInitialWorkflowState({
      run_id: `research-education-${sha256(`${source.campaign_id}\n${source.dossier_sha256}`)}`,
      parent_session_id: "ses_parent1",
      request_snapshot: { kind: "research_educationalization", ...source },
      profile_snapshot: profileSnapshot(),
      reference_snapshot: createEducationalReferenceSnapshot(source.reference_solution, source.reference_solution_sha256),
    })
    const shadowedProfile = {
      ...state,
      profile_snapshot: {
        ...state.profile_snapshot,
        review: { ...state.profile_snapshot.review, output_adapter: "review_verdict_json" as const },
      },
    }
    const changedReference = state.reference_snapshot.references.map((reference) => ({ ...reference, content: "Changed proof." }))

    expect(WorkflowStateV1Schema.safeParse(shadowedProfile).success).toBe(false)
    expect(WorkflowStateV1Schema.safeParse({
      ...state,
      reference_snapshot: { ...state.reference_snapshot, references: changedReference },
    }).success).toBe(false)
  })

  test("resumes an unfinished educationalization after restart", async () => {
    const directory = temporaryDirectory()
    const source = approvedSource()
    const control = { dispatches: 0, reviews: ["PASS"], crashAfterPrepared: true }
    const dependencies = dependenciesFor(directory, source, control)

    await expect(educationalizeResearchCampaign(request(directory), dependencies)).rejects.toThrow("planned educationalization crash")
    control.crashAfterPrepared = false
    const resumed = await educationalizeResearchCampaign(request(directory), dependencies)

    expect(resumed).toMatchObject({ ok: true, status: "FROZEN" })
    expect(control.dispatches).toBe(2)
  })
})

function temporaryDirectory(): string {
  const directory = join(process.cwd(), `.tmp-research-education-${crypto.randomUUID()}`)
  mkdirSync(directory, { recursive: true })
  directories.push(directory)
  return directory
}
