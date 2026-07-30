import { describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parse as parseJsonc } from "jsonc-parser"

import { OpenMathConfigSchema } from "../../config/schema"
import { loadReferenceSnapshot } from "../references/snapshot"
import { ReferenceManifestError } from "../references/types"
import { jsonWorkflowException } from "../../tools/openmath-workflow-shared/errors"
import { createOpenMathWorkflowAmendTool } from "../../tools/openmath-workflow-amend"
import { createOpenMathWorkflowStartTool } from "../../tools/openmath-workflow-start"
import { adaptWorkflowOutput } from "./adapters/adapter-dispatch"
import { resolveWorkflowProfilePromptSources } from "./profile-prompt-sources"

const repositoryDirectory = join(import.meta.dir, "../../..")
const exampleDirectory = join(repositoryDirectory, "docs/examples/openmath-workflow")

describe("OpenMath workflow documentation example failures", () => {
  test("maps a mutated fixture prompt URI to PROMPT_SOURCE_ERROR", () => {
    const config = OpenMathConfigSchema.parse(parseJsonc(readFileSync(join(exampleDirectory, "profile.jsonc"), "utf8").replace("SOLVER_MARKDOWN.md", "MISSING_SOLVER.md")))

    try {
      resolveWorkflowProfilePromptSources(config.workflow_profiles, exampleDirectory)
      throw new Error("Expected the fixture prompt mutation to fail")
    } catch (error) {
      const envelope = JSON.parse(jsonWorkflowException(error))
      expect(envelope).toMatchObject({ error_code: "PROMPT_SOURCE_ERROR" })
    }
  })

  test("reports the documented malformed verdict code", () => {
    const result = adaptWorkflowOutput({
      adapter: "review_verdict_markdown",
      raw_output: "VERDICT: MAYBE\nThe fixture verdict was mutated.",
    })

    expect(result).toMatchObject({ ok: false, error: { code: "MISSING_VERDICT" } })
  })

  test("reports the documented allowed-root rejection code", () => {
    expect(() => loadReferenceSnapshot({
      referenceManifestPath: join(exampleDirectory, "references.yaml"),
      projectDirectory: repositoryDirectory,
      configuredAllowedRoots: ["src"],
    })).toThrow(ReferenceManifestError)
    try {
      loadReferenceSnapshot({
        referenceManifestPath: join(exampleDirectory, "references.yaml"),
        projectDirectory: repositoryDirectory,
        configuredAllowedRoots: ["src"],
      })
    } catch (error) {
      expect(error).toBeInstanceOf(ReferenceManifestError)
      if (error instanceof ReferenceManifestError) expect(error.code).toBe("outside_allowed_roots")
    }
  })

  test("maps a stale revision supplied after a fixture amendment", async () => {
    const directory = mkdtempSync(join(tmpdir(), "openmath-docs-revision-"))
    const config = OpenMathConfigSchema.parse(parseJsonc(readFileSync(join(exampleDirectory, "profile.jsonc"), "utf8")))
    const resolved = {
      ...config,
      workflow_allowed_roots: [exampleDirectory],
      workflow_profiles: resolveWorkflowProfilePromptSources(config.workflow_profiles, exampleDirectory),
    }
    const options = { directory, openmathConfig: resolved }
    const context = { sessionID: "docs", messageID: "fixture", agent: "test", abort: new AbortController().signal }
    const start = createOpenMathWorkflowStartTool(options)
    const amend = createOpenMathWorkflowAmendTool(options)

    try {
      const started = JSON.parse(String(await start.execute({ run_id: "docs-revision", request: { kind: "markdown", instruction: "Prove the fixture." } }, context)))
      expect(started).toMatchObject({ ok: true, state_revision: 0 })
      await amend.execute({ run_id: "docs-revision", expected_state_revision: 0, operation: "add", kind: "required_check", scope: "next_review", content: "Check the base case." }, context)
      const stale = JSON.parse(String(await amend.execute({ run_id: "docs-revision", expected_state_revision: 0, operation: "add", kind: "required_check", scope: "next_review", content: "Check the induction step." }, context)))

      expect(stale).toMatchObject({ error_code: "STALE_STATE_REVISION" })
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
