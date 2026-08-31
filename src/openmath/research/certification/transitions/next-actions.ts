import type { CertificationActionContext, CertificationNextAction } from "./types"

const READY_ACTIONS = ["step_one_stage", "step_to_checkpoint", "amend", "abort"] as const
const NOT_STARTED_ACTIONS = ["step_one_stage", "step_to_checkpoint", "abort"] as const

export function getCertificationNextActions(context: CertificationActionContext): readonly CertificationNextAction[] {
  switch (context.effective_status) {
    case "NOT_STARTED":
      return buildActions(context, NOT_STARTED_ACTIONS, "READY_TO_RUN")
    case "READY":
      return buildActions(context, READY_ACTIONS, "READY_TO_RUN")
    case "RUNNING":
      return buildActions(context, ["step_one_stage", "abort"], "RECONCILIATION_REQUIRED")
    case "AWAITING_HUMAN":
      return buildActions(
        context,
        context.has_applicable_amendment ? READY_ACTIONS : ["amend", "abort"],
        context.has_applicable_amendment ? "READY_TO_RUN" : "AMENDMENT_REQUIRED",
      )
    case "BLOCKED":
      return buildActions(
        context,
        context.has_applicable_amendment ? ["step_one_stage", "amend", "abort"] : ["step_one_stage", "abort"],
        "RECONCILIATION_REQUIRED",
      )
    case "COMPLETE":
      return buildActions(context, ["step_one_stage", "abort"], "PUBLICATION_REQUIRED")
    case "BEFORE_PROMOTION":
      return buildActions(context, ["promote", "abort"], "PROMOTION_DECISION_REQUIRED")
    case "ABORTED":
      return []
    default:
      return assertNever(context.effective_status)
  }
}

function buildActions(
  context: CertificationActionContext,
  actions: readonly CertificationNextAction["action"][],
  reason: CertificationNextAction["reason"],
): readonly CertificationNextAction[] {
  return actions.map((action) => context.required_certification_revision === null
    ? { action, required_state_revision: context.required_state_revision, reason }
    : {
        action,
        required_state_revision: context.required_state_revision,
        required_certification_revision: context.required_certification_revision,
        reason,
      })
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected certification effective status: ${String(value)}`)
}
