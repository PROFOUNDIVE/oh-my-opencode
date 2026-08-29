import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { OpenMathConfigSchema } from "../../../config/schema"
import { createOpenMathWorkflowStartTool } from "../../../tools/openmath-workflow-start"
import {
  resolveInitialProfileSnapshot,
  resolveInitialReferenceSnapshot,
  resolveWorkflowRequest,
  type OpenMathWorkflowToolOptions,
} from "../../../tools/openmath-workflow-shared"
import { readWorkflowState, startWorkflowState } from "../storage"
import { startWorkflowFromCurrentSources } from "./start-workflow"
import { startWorkflowFromSnapshots } from "./start-workflow-from-snapshots"

const context = { sessionID: "parent-session", messageID: "message", agent: "test", abort: new AbortController().signal }

describe("workflow start application", () => {
  let directDirectory: string
  let wrapperDirectory: string

  beforeEach(() => {
    directDirectory = mkdtempSync(join(tmpdir(), "openmath-workflow-start-direct-"))
    wrapperDirectory = mkdtempSync(join(tmpdir(), "openmath-workflow-start-wrapper-"))
  })

  afterEach(() => {
    rmSync(directDirectory, { recursive: true, force: true })
    rmSync(wrapperDirectory, { recursive: true, force: true })
  })

  test("returns the same started state from current sources as the public wrapper", async () => {
    // #given
    const directOptions = workflowOptions(directDirectory)
    const wrapperOptions = workflowOptions(wrapperDirectory)
    const request = { kind: "markdown", instruction: "Solve the problem." } as const

    // #when
    const direct = await startWorkflowFromCurrentSources(
      { run_id: "equivalent-start", parent_session_id: context.sessionID },
      {
        resolve_request: () => resolveWorkflowRequest(request, directDirectory),
        resolve_profile: () => resolveInitialProfileSnapshot({ config: directOptions.openmathConfig, directory: directDirectory }),
        resolve_references: () => resolveInitialReferenceSnapshot({ request_references: undefined, reference_manifest_path: undefined, config: directOptions.openmathConfig, directory: directDirectory }),
        start_state: startWorkflowState,
        directory: directDirectory,
      },
    )
    await createOpenMathWorkflowStartTool(wrapperOptions).execute({ run_id: "equivalent-start", request }, context)
    const wrapper = await readWorkflowState(wrapperDirectory, "equivalent-start")

    // #then
    expect(direct.kind).toBe("ok")
    expect(wrapper.kind).toBe("ok")
    if (direct.kind === "ok" && wrapper.kind === "ok") {
      expect(direct.state).toEqual(wrapper.state)
      expect(direct.state.request_snapshot).toEqual(wrapper.state.request_snapshot)
      expect(direct.state.profile_snapshot).toEqual(wrapper.state.profile_snapshot)
      expect(direct.state.reference_snapshot).toEqual(wrapper.state.reference_snapshot)
    }
  })

  test("starts from already-frozen snapshots without resolving current sources", async () => {
    // #given
    const options = workflowOptions(directDirectory)
    const request = await resolveWorkflowRequest({ kind: "markdown", instruction: "Frozen instruction." }, directDirectory)
    const profile = await resolveInitialProfileSnapshot({ config: options.openmathConfig, directory: directDirectory })
    const references = resolveInitialReferenceSnapshot({ request_references: undefined, reference_manifest_path: undefined, config: options.openmathConfig, directory: directDirectory })

    // #when
    const result = await startWorkflowFromSnapshots({
      directory: directDirectory,
      run_id: "snapshot-start",
      parent_session_id: context.sessionID,
      request_snapshot: request.snapshot,
      profile_snapshot: profile,
      reference_snapshot: references,
      artifact: request.initial_artifact,
    }, { start_state: startWorkflowState })

    // #then
    expect(result.kind).toBe("ok")
    if (result.kind === "ok") {
      expect(result.state.request_snapshot).toEqual(request.snapshot)
      expect(result.state.profile_snapshot).toEqual(profile)
      expect(result.state.reference_snapshot).toEqual(references)
      expect(result.state.artifact).toBeNull()
    }
  })
})

function workflowOptions(directory: string): OpenMathWorkflowToolOptions {
  return {
    directory,
    openmathConfig: OpenMathConfigSchema.parse({
      default_workflow_profile: "application-profile",
      workflow_profiles: {
        "application-profile": {
          solve: { agent: "solver", model: "openai/solver", prompt: { kind: "inline", content: "solve" }, output_adapter: "opaque_markdown" },
          review: { agent: "reviewer", model: "openai/reviewer", prompt: { kind: "inline", content: "review" }, output_adapter: "review_verdict_markdown" },
          revise: { agent: "reviser", model: "openai/reviser", prompt: { kind: "inline", content: "revise" }, output_adapter: "full_replace_markdown" },
          min_review_rounds: 1,
          max_review_rounds: 2,
          required_consecutive_passes: 1,
          checkpoint: "none",
        },
      },
    }),
  }
}
