import { describe, expect, test } from "bun:test"

import { workflowInputFromSnapshot } from "../../../tools/openmath-workflow-shared"
import { WorkflowRequestSnapshotSchema } from "../state"
import { serializeWorkflowInputSnapshot } from "./serialize-workflow-input-snapshot"

describe("workflow input snapshot serialization", () => {
  test("keeps the shared API on the canonical workflow serializer", () => {
    // #given
    const sharedSerializer = workflowInputFromSnapshot

    // #when
    const canonicalSerializer = serializeWorkflowInputSnapshot

    // #then
    expect(sharedSerializer).toBe(canonicalSerializer)
  })

  test("preserves the existing JSON bytes", () => {
    // #given
    const snapshot = WorkflowRequestSnapshotSchema.parse({ kind: "markdown", instruction: "Serialize exactly." })

    // #when
    const serialized = serializeWorkflowInputSnapshot(snapshot)

    // #then
    expect(serialized).toBe(JSON.stringify(snapshot))
  })
})
