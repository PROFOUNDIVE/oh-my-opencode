import { WorkflowStateV1Schema, type WorkflowStateV1 } from "./schema"

export type WorkflowStateReadResult =
  | { readonly kind: "ok"; readonly state: WorkflowStateV1 }
  | { readonly kind: "error"; readonly error_code: "STORAGE_READ_FAILED"; readonly message: string }

export function parseWorkflowStateV1Json(content: string): WorkflowStateReadResult {
  let raw: unknown
  try {
    raw = JSON.parse(content)
  } catch {
    return { kind: "error", error_code: "STORAGE_READ_FAILED", message: "Workflow state is not valid JSON" }
  }

  const parsed = WorkflowStateV1Schema.safeParse(raw)
  if (!parsed.success) {
    return { kind: "error", error_code: "STORAGE_READ_FAILED", message: "Workflow state is invalid or unsupported" }
  }
  return { kind: "ok", state: parsed.data }
}
