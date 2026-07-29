import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { OpenMathConfigSchema } from "../../config/schema"
import {
  resolveWorkflowProfilePromptSources,
  resolveWorkflowProfileSnapshot,
  WorkflowProfileResolutionError,
} from "./index"

describe("workflow profile prompt provenance", () => {
  let directory: string

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "openmath-workflow-stale-source-"))
  })

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  test("rejects stale file prompt provenance instead of rereading a changed source", () => {
    // given
    writeFileSync(join(directory, "original.md"), "ORIGINAL_V1", "utf8")
    const parsedConfig = OpenMathConfigSchema.parse({
      default_workflow_profile: "stale-source",
      workflow_profiles: {
        "stale-source": {
          solve: {
            agent: "solver-markdown",
            prompt: { kind: "file", uri: "file://./original.md" },
            output_adapter: "legacy_omo_sections",
          },
          review: {
            agent: "reference-reviewer-markdown",
            prompt: { kind: "builtin" },
            output_adapter: "review_verdict_json",
          },
          revise: {
            agent: "solver-markdown-patch",
            prompt: { kind: "builtin" },
            output_adapter: "patch_set_json",
          },
          min_review_rounds: 1,
          max_review_rounds: 3,
          required_consecutive_passes: 1,
          checkpoint: "none",
        },
      },
    })
    const profiles = resolveWorkflowProfilePromptSources(parsedConfig.workflow_profiles, directory)
    const selectedProfile = profiles["stale-source"]
    if (!selectedProfile) throw new Error("Expected stale-source profile")
    selectedProfile.solve.prompt = { kind: "file", uri: "file://./changed.md" }
    const config = { ...parsedConfig, workflow_profiles: profiles }

    // when
    const resolve = () => resolveWorkflowProfileSnapshot({
      config,
      resolveAgentModel: (agent) => ({ providerID: "test-provider", modelID: agent }),
    })

    // then
    expect(resolve).toThrow(WorkflowProfileResolutionError)
    expect(resolve).toThrow("Workflow file prompt provenance is stale: stale-source.solve")
  })
})
