import type { WorkflowStateV1 } from "../state"
import type { TransitionResult } from "./types"

export function transitioned(
  state: WorkflowStateV1,
  directive: "none" | "dispatch" | "reconcile" = "none",
): TransitionResult {
  return { ok: true, directive, state }
}

export function rejected(
  state: WorkflowStateV1,
  errorCode: "ILLEGAL_TRANSITION" | "VALIDATION_ERROR",
  message: string,
): TransitionResult {
  return { ok: false, error_code: errorCode, message, state }
}
