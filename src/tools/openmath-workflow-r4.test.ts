import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { OpenMathConfigSchema } from "../config/schema"
import { WorkflowStateV1Schema } from "../openmath/workflow/state"
import { getWorkflowRunDirectory, startWorkflowState } from "../openmath/workflow/storage"
import { stateForFamily, type StateFamily } from "../openmath/workflow/transitions/legality-test-fixture"
import { createOpenMathWorkflowStatusTool } from "./openmath-workflow-status"
import type { OpenMathWorkflowToolOptions } from "./openmath-workflow-shared"

const families: readonly StateFamily[] = ["READY", "RUNNING", "CHECKPOINT", "INCONCLUSIVE_UNSATISFIED", "PARSE_FAILURE_UNSATISFIED", "BLOCKED", "PASSED", "EXHAUSTED", "ABORTED"]
const context = { sessionID: "parent", messageID: "message", agent: "test", abort: new AbortController().signal }

describe("Task 12 R4 executed status envelopes", () => {
  let directory: string

  beforeEach(() => { directory = mkdtempSync(join(tmpdir(), "openmath-workflow-r4-")) })
  afterEach(() => { rmSync(directory, { recursive: true, force: true }) })

  test("snapshots real status envelopes across workflow state families", async () => {
    const status = createOpenMathWorkflowStatusTool(options(directory))
    const envelopes: unknown[] = []
    for (const family of families) {
      const state = WorkflowStateV1Schema.parse({ ...stateForFamily(family), run_id: `r4-${family}`, state_revision: 0, amendments: [] })
      await startWorkflowState({ directory, state })
      envelopes.push(JSON.parse(String(await status.execute({ run_id: state.run_id }, context))))
    }
    expect(envelopes).toMatchSnapshot()
  })

  test("status preserves revision filenames and bytes", async () => {
    const state = WorkflowStateV1Schema.parse({ ...stateForFamily("READY"), run_id: "r4-status", state_revision: 0, amendments: [] })
    await startWorkflowState({ directory, state })
    const runDirectory = getWorkflowRunDirectory(directory, state.run_id)
    const before = revisionBytes(runDirectory)
    await createOpenMathWorkflowStatusTool(options(directory)).execute({ run_id: state.run_id }, context)
    expect(revisionBytes(runDirectory)).toEqual(before)
  })
})

function options(directory: string): OpenMathWorkflowToolOptions {
  return { directory, openmathConfig: OpenMathConfigSchema.parse({}) }
}

function revisionBytes(directory: string): readonly [string, string][] {
  return readdirSync(directory).filter((name) => name.startsWith("state.rev-")).sort().map((name) => [name, readFileSync(join(directory, name), "utf8")])
}
