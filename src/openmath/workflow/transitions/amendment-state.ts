import type { WorkflowStateV1 } from "../state"
import type { AmendmentScope, RenderedAmendment } from "./types"

type AmendmentEntry = {
  readonly amendment: RenderedAmendment
  readonly consumed: boolean
}

export function getActiveAmendments(state: WorkflowStateV1): ReadonlyMap<string, AmendmentEntry> {
  const active = new Map<string, AmendmentEntry>()
  for (const event of state.amendments) {
    switch (event.event_type) {
      case "ADDED":
        if (!isAmendmentScope(event.scope)) break
        active.set(event.amendment_id, {
          amendment: {
            amendment_id: event.amendment_id,
            kind: event.kind,
            scope: event.scope,
            content: event.content,
          },
          consumed: false,
        })
        break
      case "CONSUMED": {
        const entry = active.get(event.amendment_id)
        if (entry) active.set(event.amendment_id, { amendment: entry.amendment, consumed: true })
        break
      }
      case "RETRACTED":
        active.delete(event.amendment_id)
        break
      default:
        assertNever(event)
    }
  }
  return active
}

export function isAmendmentScope(scope: string): scope is AmendmentScope {
  return scope === "next_review" || scope === "all_remaining" || /^round:[1-9][0-9]*$/.test(scope)
}

export function isAmendmentApplicable(
  scope: AmendmentScope,
  state: WorkflowStateV1,
  stage: "SOLVE" | "REVIEW" | "REVISE",
): boolean {
  if (scope === "all_remaining") return true
  if (scope === "next_review") return stage === "REVIEW"
  return Number(scope.slice("round:".length)) === state.review_round
}

export function renderApplicableAmendments(
  state: WorkflowStateV1,
  stage: "SOLVE" | "REVIEW" | "REVISE",
): readonly RenderedAmendment[] {
  return [...getActiveAmendments(state).values()]
    .filter((entry) => !entry.consumed && isAmendmentApplicable(entry.amendment.scope, state, stage))
    .map((entry) => entry.amendment)
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected amendment event: ${String(value)}`)
}
