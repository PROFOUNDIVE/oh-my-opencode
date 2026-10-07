import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { getOpenMathStorageDirectory } from "../openmath/storage-directory"
import { removeTemporaryCampaignDirectory } from "../openmath/research/application/application-test-fixture"
import { createFactoryStepDependencies } from "../openmath/research/e2e/tool-factory-dependencies"
import { readResearchCampaignState } from "../openmath/research/storage"
import { getWorkflowStatus } from "../openmath/workflow/application/get-workflow-status"
import { createOpenMathResearchTools } from "./openmath-research-tools"
import { researchToolConfig, researchToolContext } from "./openmath-research-test-support"

const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) removeTemporaryCampaignDirectory(directory)
})

describe("research tools with local storage", () => {
  test("runs the public lifecycle using local revisions while resolving project sources", async () => {
    // given
    const directory = mkdtempSync(join(tmpdir(), "research-project-"))
    const root = mkdtempSync(join(tmpdir(), "research-storage-"))
    directories.push(directory, root)
    const storageDirectory = getOpenMathStorageDirectory(directory, root)
    writeFileSync(join(directory, "objective.md"), "1. Prove the project theorem.")
    const factory = createFactoryStepDependencies(storageDirectory, "KEEP", { project_directory: directory })
    const config = researchToolConfig()
    const profile = config.research_profiles?.["phase-a"]
    if (profile === undefined) throw new TypeError("Missing research profile")
    const tools = createOpenMathResearchTools({
      directory,
      openmathConfig: {
        ...config, storage_root: root,
        research_profiles: { "phase-a": { ...profile, survivor_limit: 2 } },
      },
      createStepDependencies: () => factory.dependencies,
    })
    const execute = async (name: string, input: Record<string, unknown>) => {
      const selected = tools[name]
      if (selected === undefined) throw new TypeError(`Missing tool ${name}`)
      return JSON.parse(await selected.execute(input, researchToolContext()))
    }

    // when
    let result = await execute("openmath_research_start", {
      campaign_id: "campaign-a",
      objective: { kind: "problem", source: { kind: "file", file_path: "objective.md", problem_number: 1 } },
    })
    expect(result.ok).toBe(true)
    result = await execute("openmath_research_amend", {
      campaign_id: "campaign-a", expected_state_revision: result.state_revision,
      operation: "add", kind: "question", scope: "all_candidates", content: "Check the theorem.",
    })
    expect(result.ok).toBe(true)
    const stale = await execute("openmath_research_step", {
      campaign_id: "campaign-a", expected_state_revision: 0, mode: "one_stage",
    })
    expect(stale).toMatchObject({ ok: false, error_code: "STALE_STATE_REVISION" })
    for (let count = 0; count < 10 && result.phase !== "PROMOTION"; count += 1) {
      result = await execute("openmath_research_step", {
        campaign_id: "campaign-a", expected_state_revision: result.state_revision, mode: "one_stage",
      })
      expect(result).toMatchObject({ ok: true })
    }
    result = await execute("openmath_research_step", {
      campaign_id: "campaign-a", expected_state_revision: result.state_revision, mode: "one_stage",
    })
    expect(result.ok).toBe(true)
    result = await execute("openmath_research_promote", {
      campaign_id: "campaign-a", expected_state_revision: result.state_revision,
      dossier_sha256: result.dossier.content_sha256, decision: "approve",
    })
    const status = await execute("openmath_research_status", { campaign_id: "campaign-a" })

    // then
    expect(result).toMatchObject({ ok: true, status: "PROMOTION_READY" })
    expect(status).toEqual(result)
    const stored = await readResearchCampaignState(storageDirectory, "campaign-a")
    expect(stored.kind).toBe("ok")
    if (stored.kind !== "ok") throw new TypeError(stored.message)
    expect(stored.state.source_snapshot.objective.request).toMatchObject({
      kind: "problem", source: { kind: "file", resolved_path: join(directory, "objective.md") },
    })
    for (const candidate of stored.state.candidates) {
      expect((await getWorkflowStatus({ directory: storageDirectory, run_id: candidate.child_run_id })).kind).toBe("ok")
    }
    expect(existsSync(join(directory, ".sisyphus"))).toBe(false)
    const abortable = await execute("openmath_research_start", {
      campaign_id: "campaign-abort", objective: { kind: "markdown", instruction: "Abort this campaign." },
    })
    const aborted = await execute("openmath_research_abort", {
      campaign_id: "campaign-abort", expected_state_revision: abortable.state_revision, reason: "Finish test",
    })
    expect(aborted).toMatchObject({ ok: true, status: "ABORTED" })
  })
})
