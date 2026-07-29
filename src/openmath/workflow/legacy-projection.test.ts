import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import type { ToolContext } from "@opencode-ai/plugin/tool"

import { getOpenMathStateFilePath, readOpenMathSessionState, writeOpenMathSessionState } from "../storage"
import { createOpenMathStateTools } from "../../tools/openmath-state/tools"
import {
  importLegacySolveOnlyState,
  projectWorkflowStateToLegacy,
  WorkflowStateV1Schema,
} from "./state"
import { createWorkflowStateFixture } from "./state/test-fixture"

const context = {
  sessionID: "parent",
  messageID: "message",
  agent: "test-agent",
  abort: new AbortController().signal,
  metadata: () => {},
  ask: async () => {},
} satisfies ToolContext

describe("legacy workflow projection", () => {
  test("imports a legacy solve-only state once and projects its complete public shape", () => {
    // given
    const legacySource = readFileSync(join(import.meta.dir, "..", "fixtures", "legacy-frozen-session.json"))
    const fixture = createWorkflowStateFixture()

    // when
    const imported = importLegacySolveOnlyState({
      source_bytes: legacySource,
      parent_session_id: "immutable-parent",
      legacy_profile_name: "legacy-educational-json",
      invocation: "solve_only",
      profile_snapshot: fixture.profile_snapshot,
      reference_snapshot: fixture.reference_snapshot,
      existing_state: null,
    })

    // then
    expect(imported.kind).toBe("imported")
    if (imported.kind !== "imported") throw new Error(imported.message)
    expect(imported.state.schema_version).toBe(1)
    expect(imported.state.parent_session_id).toBe("immutable-parent")

    const projection = projectWorkflowStateToLegacy(imported.state)
    expect(projection.kind).toBe("projected")
    if (projection.kind !== "projected") throw new Error(projection.message)
    expect(projection.state).toEqual(JSON.parse(new TextDecoder().decode(legacySource)))

    const repeated = importLegacySolveOnlyState({
      source_bytes: legacySource,
      parent_session_id: "different-resuming-session",
      legacy_profile_name: "legacy-educational-json",
      invocation: "solve_only",
      profile_snapshot: fixture.profile_snapshot,
      reference_snapshot: fixture.reference_snapshot,
      existing_state: imported.state,
    })
    expect(repeated).toMatchObject({ kind: "skipped" })
  })

  test("keeps Linux and Windows legacy file behavior and state-tool resets isolated from workflow revisions", async () => {
    // given
    const directory = mkdtempSync(join(tmpdir(), "openmath-workflow-projection-"))
    const state = createWorkflowStateFixture()
    const projected = projectWorkflowStateToLegacy(WorkflowStateV1Schema.parse(state))
    if (projected.kind !== "projected") throw new Error(projected.message)
    const workflowRevision = join(directory, ".sisyphus", "openmath-workflows", "run", "state.rev-000000000000.json")
    mkdirSync(dirname(workflowRevision), { recursive: true })
    writeFileSync(workflowRevision, "workflow revision", { encoding: "utf8", flag: "w" })

    // when
    expect(writeOpenMathSessionState(directory, projected.state, "linux")).toBe(true)
    expect(writeOpenMathSessionState(directory, projected.state, "windows")).toBe(true)
    await createOpenMathStateTools(directory).openmath_state_set.execute({ state: projected.state }, context)
    await createOpenMathStateTools(directory).openmath_state_reset.execute({ session_id: projected.state.session_id }, context)

    // then
    expect(readOpenMathSessionState(directory, projected.state.session_id, "linux")).toBeNull()
    expect(existsSync(getOpenMathStateFilePath(directory, projected.state.session_id, "windows"))).toBe(false)
    expect(readFileSync(workflowRevision, "utf8")).toBe("workflow revision")
    rmSync(directory, { recursive: true, force: true })
  })
})
