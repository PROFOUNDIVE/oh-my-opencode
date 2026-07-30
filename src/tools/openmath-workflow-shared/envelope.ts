import { z } from "zod"

import { ArtifactDtoSchema, ReviewDtoSchema, WorkflowStateV1Schema } from "../../openmath/workflow/state"
import { WorkflowErrorCodeSchema, WorkflowStageSchema, WorkflowStatusSchema } from "../../openmath/workflow/state/literals"
import { getNextActions } from "../../openmath/workflow/transitions"
import type { WorkflowStateV1 } from "../../openmath/workflow/state"

const NextActionSchema = z.object({
  action: z.enum(["step_one_stage", "step_to_checkpoint", "amend", "reload_prompts", "reload_references", "abort"]),
  required_state_revision: z.number().int().nonnegative(),
  reason: z.enum(["READY_TO_RUN", "CHECKPOINT_PAUSED", "INPUT_CHANGE_REQUIRED", "RECONCILIATION_BLOCKED"]),
}).strict()

export const WorkflowSuccessEnvelopeSchema = z.object({
  ok: z.literal(true),
  run_id: z.string().min(1),
  state_revision: z.number().int().nonnegative(),
  status: WorkflowStatusSchema,
  stage: WorkflowStageSchema.nullable(),
  artifact: ArtifactDtoSchema.nullable(),
  latest_review: ReviewDtoSchema.nullable(),
  next_actions: z.array(NextActionSchema),
}).strict()

export const WorkflowErrorEnvelopeSchema = z.object({
  ok: z.literal(false),
  error_code: WorkflowErrorCodeSchema,
  message: z.string(),
  current_state_revision: z.number().int().nonnegative().optional(),
}).strict()

export type WorkflowSuccessEnvelope = z.infer<typeof WorkflowSuccessEnvelopeSchema>
export type WorkflowErrorEnvelope = z.infer<typeof WorkflowErrorEnvelopeSchema>

export function workflowSuccessEnvelope(state: WorkflowStateV1): WorkflowSuccessEnvelope {
  const nextActions = getNextActions(state)
  return WorkflowSuccessEnvelopeSchema.parse({
    ok: true,
    run_id: state.run_id,
    state_revision: state.state_revision,
    status: state.status,
    stage: workflowStage(state),
    artifact: state.artifact,
    latest_review: state.latest_review,
    next_actions: nextActions,
  })
}

export function workflowErrorEnvelope(
  error: Readonly<{ readonly error_code: z.infer<typeof WorkflowErrorCodeSchema>; readonly message: string; readonly current_state_revision?: number }>,
): WorkflowErrorEnvelope {
  return WorkflowErrorEnvelopeSchema.parse({
    ok: false,
    error_code: error.error_code,
    message: error.message,
    ...(error.current_state_revision === undefined ? {} : { current_state_revision: error.current_state_revision }),
  })
}

export function jsonWorkflowSuccess(state: WorkflowStateV1): string {
  return JSON.stringify(workflowSuccessEnvelope(WorkflowStateV1Schema.parse(state)))
}

export function jsonWorkflowError(error: Parameters<typeof workflowErrorEnvelope>[0]): string {
  return JSON.stringify(workflowErrorEnvelope(error))
}

function workflowStage(state: WorkflowStateV1): z.infer<typeof WorkflowStageSchema> | null {
  switch (state.status) {
    case "READY":
    case "RUNNING":
    case "AWAITING_HUMAN":
    case "BLOCKED":
      return state.next_stage
    case "PASSED":
    case "EXHAUSTED":
    case "ABORTED":
      return null
    default:
      return assertNever(state)
  }
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected workflow state: ${String(value)}`)
}
