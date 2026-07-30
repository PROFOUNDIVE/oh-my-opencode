import { describe, expect, test } from "bun:test"
import { z } from "zod"

import { OpenMathConfigSchema } from "../config/schema"
import { createOpenMathWorkflowAbortTool } from "./openmath-workflow-abort"
import { createOpenMathWorkflowAmendTool } from "./openmath-workflow-amend"
import { createOpenMathWorkflowReloadTool } from "./openmath-workflow-reload"
import { createOpenMathWorkflowStartTool } from "./openmath-workflow-start"
import { createOpenMathWorkflowStatusTool } from "./openmath-workflow-status"
import { createOpenMathWorkflowStepTool } from "./openmath-workflow-step"
import type { OpenMathWorkflowToolOptions } from "./openmath-workflow-shared"

const options: OpenMathWorkflowToolOptions = { directory: "/tmp", openmathConfig: OpenMathConfigSchema.parse({}) }

describe("Task 12 public tool schemas", () => {
  test("rejects malformed inputs through advertised args", () => {
    const schemas = [
      schemaFor(createOpenMathWorkflowStartTool(options)),
      schemaFor(createOpenMathWorkflowStepTool(options)),
      schemaFor(createOpenMathWorkflowStatusTool(options)),
      schemaFor(createOpenMathWorkflowReloadTool(options)),
      schemaFor(createOpenMathWorkflowAbortTool(options)),
    ]
    const malformed = [
      { run_id: "", request: { schema_version: 1, state_revision: 0 } },
      { run_id: "run", expected_state_revision: 1.5 },
      { run_id: "" },
      { run_id: "run", expected_state_revision: -1, targets: [] },
      { run_id: "run", expected_state_revision: -1 },
    ]
    expect(schemas.every((schema, index) => !schema.safeParse(malformed[index]).success)).toBe(true)
  })

  test("advertises both amend branches while exact parsing owns sibling correlation", () => {
    const schema = schemaFor(createOpenMathWorkflowAmendTool(options))
    expect(schema.safeParse({ run_id: "run", expected_state_revision: 0, operation: "add", kind: "question", scope: "next_review", content: "check" }).success).toBe(true)
    expect(schema.safeParse({ run_id: "run", expected_state_revision: 0, operation: "retract", amendment_id: "amendment-1" }).success).toBe(true)
    expect(schema.safeParse({ run_id: "run", expected_state_revision: 0, operation: "add", kind: "question", scope: "later", content: "check" }).success).toBe(false)
    expect(schema.safeParse({ run_id: "run", expected_state_revision: 0, operation: "add", kind: "question", scope: "next_review", content: " " }).success).toBe(false)
    expect(schema.safeParse({ run_id: "run", expected_state_revision: 0, operation: "retract", amendment_id: " " }).success).toBe(false)
  })

  test("snapshots advertised schemas for all six tools", () => {
    const definitions = [
      createOpenMathWorkflowStartTool(options), createOpenMathWorkflowStepTool(options), createOpenMathWorkflowStatusTool(options),
      createOpenMathWorkflowAmendTool(options), createOpenMathWorkflowReloadTool(options), createOpenMathWorkflowAbortTool(options),
    ]
    expect(definitions.map((definition) => z.toJSONSchema(schemaFor(definition)))).toMatchSnapshot()
  })
})

function schemaFor(definition: ReturnType<typeof createOpenMathWorkflowStartTool>): z.ZodObject<z.ZodRawShape> {
  return z.object(definition.args)
}
