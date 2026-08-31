import type { WorkflowStateV1 } from "../state"
import { reduceAddAmendment } from "./add-amendment"
import { reduceCommitStageReceipt } from "./commit-stage"
import { reduceReloadSources } from "./reload-sources"
import { reduceAbort } from "./request-abort"
import { reduceStep } from "./request-step"
import { reduceRetractAmendment } from "./retract-amendment"
import type { TransitionResult, WorkflowTransitionEvent } from "./types"
import { rejected } from "./result"

export function reduceTransition(state: WorkflowStateV1, event: WorkflowTransitionEvent): TransitionResult {
  if (
    state.request_snapshot?.kind === "research_educationalization"
    && (event.type === "ADD_AMENDMENT" || event.type === "RETRACT_AMENDMENT" || event.type === "RELOAD")
  ) {
    return rejected(state, "ILLEGAL_TRANSITION", "Research educationalization snapshots and review outcomes are immutable")
  }
  switch (event.type) {
    case "STEP":
      return reduceStep(state, event)
    case "ADD_AMENDMENT":
      return reduceAddAmendment(state, event)
    case "RETRACT_AMENDMENT":
      return reduceRetractAmendment(state, event)
    case "RELOAD":
      return reduceReloadSources(state, event)
    case "ABORT":
      return reduceAbort(state, event)
    case "COMMIT_STAGE_RECEIPT":
      return reduceCommitStageReceipt(state)
    default:
      return assertNever(event)
  }
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected transition event: ${String(value)}`)
}
