import type { WorkflowStateV1 } from "../state"
import type { WorkflowErrorCode } from "../state/literals"

export type WorkflowApplicationResult =
  | { readonly kind: "ok"; readonly state: WorkflowStateV1 }
  | {
      readonly kind: "error"
      readonly error_code: WorkflowErrorCode
      readonly message: string
      readonly current_state_revision?: number
    }
