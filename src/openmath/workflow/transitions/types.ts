import type { WorkflowStateV1 } from "../state"

export type StepMode = "one_stage" | "to_checkpoint"
export type AmendmentKind = "question" | "required_check" | "suspected_blocker" | "scope_change"
export type AmendmentScope = "next_review" | "all_remaining" | `round:${number}`

export type WorkflowTransitionEvent =
  | { readonly type: "STEP"; readonly mode: StepMode }
  | {
      readonly type: "ADD_AMENDMENT"
      readonly kind: string
      readonly scope: string
      readonly content: string
    }
  | { readonly type: "RETRACT_AMENDMENT"; readonly amendment_id: string }
  | {
      readonly type: "RELOAD"
      readonly profile_snapshot?: WorkflowStateV1["profile_snapshot"]
      readonly reference_snapshot?: WorkflowStateV1["reference_snapshot"]
    }
  | { readonly type: "ABORT"; readonly reason?: string }
  | { readonly type: "COMMIT_STAGE_RECEIPT" }

export type TransitionResult =
  | {
      readonly ok: true
      readonly directive: "none" | "dispatch" | "reconcile"
      readonly state: WorkflowStateV1
    }
  | {
      readonly ok: false
      readonly error_code: "ILLEGAL_TRANSITION" | "VALIDATION_ERROR"
      readonly message: string
      readonly state: WorkflowStateV1
    }

export type NextAction = {
  readonly action:
    | "step_one_stage"
    | "step_to_checkpoint"
    | "amend"
    | "reload_prompts"
    | "reload_references"
    | "abort"
  readonly required_state_revision: number
  readonly reason: "READY_TO_RUN" | "CHECKPOINT_PAUSED" | "INPUT_CHANGE_REQUIRED" | "RECONCILIATION_BLOCKED"
}

export type RenderedAmendment = {
  readonly amendment_id: string
  readonly kind: AmendmentKind
  readonly scope: AmendmentScope
  readonly content: string
}
