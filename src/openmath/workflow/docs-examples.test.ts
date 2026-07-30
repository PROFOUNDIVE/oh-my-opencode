import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { parse as parseJsonc } from "jsonc-parser"

import { OpenMathConfigSchema } from "../../config/schema"
import { OPENMATH_WORKFLOW_COMMAND_DEFINITIONS } from "../../features/builtin-commands/workflow-command-definitions"
import { loadReferenceSnapshot } from "../references/snapshot"
import { createOpenMathWorkflowTools } from "../../tools/openmath-workflow-tools"
import {
  resolveWorkflowProfilePromptSources,
  resolveWorkflowProfileSnapshot,
} from "."

const repositoryDirectory = join(import.meta.dir, "../../..")
const exampleDirectory = join(repositoryDirectory, "docs/examples/openmath-workflow")

describe("OpenMath workflow documentation examples", () => {
  test("parses the profile, captures immutable prompts and references, and uses a full markdown replacement reviser", () => {
    const config = OpenMathConfigSchema.parse(parseJsonc(readFileSync(join(exampleDirectory, "profile.jsonc"), "utf8")))
    const resolved = {
      ...config,
      workflow_profiles: resolveWorkflowProfilePromptSources(config.workflow_profiles, exampleDirectory),
    }
    const profile = resolveWorkflowProfileSnapshot({
      config: resolved,
      resolveAgentModel: () => ({ providerID: "openai", modelID: "gpt-5.3-codex" }),
    })
    const references = loadReferenceSnapshot({
      referenceManifestPath: join(exampleDirectory, "references.yaml"),
      projectDirectory: repositoryDirectory,
      configuredAllowedRoots: ["."],
    })

    expect(profile.revise.output_adapter).toBe("full_replace_markdown")
    expect(profile.required_consecutive_passes).toBe(2)
    expect(profile.min_review_rounds).toBe(5)
    expect(Object.isFrozen(profile)).toBe(true)
    expect(Object.isFrozen(references)).toBe(true)
    expect(references.references).toHaveLength(2)
    expect(Object.keys(createOpenMathWorkflowTools({ directory: repositoryDirectory, openmathConfig: resolved }))).toEqual([
      "openmath_workflow_start",
      "openmath_workflow_step",
      "openmath_workflow_status",
      "openmath_workflow_amend",
      "openmath_workflow_reload",
      "openmath_workflow_abort",
    ])
    expect(Object.keys(OPENMATH_WORKFLOW_COMMAND_DEFINITIONS)).toEqual([
      "openmath-workflow-start",
      "openmath-workflow-step",
      "openmath-workflow-status",
      "openmath-workflow-amend",
      "openmath-workflow-reload",
      "openmath-workflow-abort",
    ])
  })
})
