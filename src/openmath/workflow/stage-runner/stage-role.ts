import type { WorkflowStateV1 } from "../state"
import type { WorkflowStage } from "../state/literals"

export function roleForWorkflowStage(state: WorkflowStateV1, stage: WorkflowStage) {
  switch (stage) {
    case "SOLVE":
      return state.profile_snapshot.solve
    case "REVIEW":
      return state.profile_snapshot.review
    case "REVISE":
      return state.legacy_projection.kind === "solve_only"
        && state.legacy_projection.markdown_fallback?.regenerate_next === true
        ? state.profile_snapshot.solve
        : state.profile_snapshot.revise
    default:
      return assertNever(stage)
  }
}

export function referenceStageForWorkflowStage(stage: WorkflowStage): "solve" | "review" | "revise" {
  switch (stage) {
    case "SOLVE":
      return "solve"
    case "REVIEW":
      return "review"
    case "REVISE":
      return "revise"
    default:
      return assertNever(stage)
  }
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected workflow stage: ${String(value)}`)
}
