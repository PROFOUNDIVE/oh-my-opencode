import type { CertificationAmendmentEvent } from "../state/amendments"
import { CertificationAmendmentIdSchema } from "../state/literals"
import type { ResearchCertificationStateV1 } from "../state/schema"
import type { CertificationJobAttempt } from "../state/jobs"
import { certificationFailure, certificationSuccess } from "./transition-result"
import type { CertificationTransitionEvent, CertificationTransitionResult } from "./types"

type AddEvent = Extract<CertificationTransitionEvent, { readonly type: "ADD_AMENDMENT" }>
type RetractEvent = Extract<CertificationTransitionEvent, { readonly type: "RETRACT_AMENDMENT" }>
type ConsumeEvent = Extract<CertificationTransitionEvent, { readonly type: "CONSUME_AMENDMENTS" }>

export function activeCertificationAmendments(
  state: ResearchCertificationStateV1,
): readonly Extract<CertificationAmendmentEvent, { readonly event_type: "ADDED" }>[] {
  const inactive = new Set(state.amendments
    .filter((event) => event.event_type !== "ADDED")
    .map((event) => event.amendment_id))
  return state.amendments.filter((event): event is Extract<CertificationAmendmentEvent, { readonly event_type: "ADDED" }> =>
    event.event_type === "ADDED" && !inactive.has(event.amendment_id))
}

export function reduceAddCertificationAmendment(
  state: ResearchCertificationStateV1,
  event: AddEvent,
): CertificationTransitionResult {
  if (!allowsAmendment(state)) return certificationFailure(state, "ILLEGAL_TRANSITION", "Certification status cannot accept amendments")
  const revision = state.certification_revision + 1
  return certificationSuccess(state, {
    ...state,
    certification_revision: revision,
    amendments: [...state.amendments, {
      event_type: "ADDED",
      amendment_id: `cert-amendment-${revision}`,
      kind: event.kind,
      scope: event.scope,
      content: event.content,
      lifecycle: "ACTIVE",
      certification_revision: revision,
    }],
  })
}

export function reduceRetractCertificationAmendment(
  state: ResearchCertificationStateV1,
  event: RetractEvent,
): CertificationTransitionResult {
  return terminateAmendments(state, [event.amendment_id], "RETRACTED")
}

export function reduceConsumeCertificationAmendments(
  state: ResearchCertificationStateV1,
  event: ConsumeEvent,
): CertificationTransitionResult {
  return terminateAmendments(state, event.amendment_ids, "CONSUMED")
}

export function certificationAmendmentConsumptionEvents(
  state: ResearchCertificationStateV1,
  amendmentIds: readonly string[],
  revision: number,
): readonly CertificationAmendmentEvent[] | null {
  const activeIds = new Set<string>(activeCertificationAmendments(state).map((event) => event.amendment_id))
  if (new Set(amendmentIds).size !== amendmentIds.length || amendmentIds.some((id) => !activeIds.has(id))) return null
  return amendmentIds.map((amendmentId) => ({
    event_type: "CONSUMED",
    amendment_id: CertificationAmendmentIdSchema.parse(amendmentId),
    lifecycle: "ACTIVE",
    certification_revision: revision,
  }))
}

export function certificationAmendmentsApplyToJobs(
  state: ResearchCertificationStateV1,
  amendmentIds: readonly string[],
  jobs: readonly CertificationJobAttempt[],
): boolean {
  const selected = activeCertificationAmendments(state).filter((event) => amendmentIds.includes(event.amendment_id))
  return selected.length === amendmentIds.length && selected.every((amendment) => jobs.some((job) => {
    switch (job.target.kind) {
      case "EXTRACTION":
        return amendment.scope === "graph"
      case "COVERAGE":
        return amendment.scope === "coverage"
      case "ATTACK":
        return amendment.scope === `counterexample:${job.target.obligation_id}`
      case "WITNESS":
        return amendment.scope === `witness:${job.target.attack_attempt_id}`
      default:
        return assertNever(job.target)
    }
  }))
}

function terminateAmendments(
  state: ResearchCertificationStateV1,
  amendmentIds: readonly string[],
  eventType: "CONSUMED" | "RETRACTED",
): CertificationTransitionResult {
  if (!allowsAmendment(state)) return certificationFailure(state, "ILLEGAL_TRANSITION", "Certification status cannot mutate amendments")
  const terminalEvents = eventType === "CONSUMED"
    ? certificationAmendmentConsumptionEvents(state, amendmentIds, state.certification_revision + 1)
    : retractionEvents(state, amendmentIds, state.certification_revision + 1)
  if (amendmentIds.length === 0 || terminalEvents === null) {
    return certificationFailure(state, "VALIDATION_ERROR", "Amendment is stale, terminal, or unknown")
  }
  const revision = state.certification_revision + 1
  return certificationSuccess(state, {
    ...state,
    certification_revision: revision,
    amendments: [...state.amendments, ...terminalEvents],
  })
}

function retractionEvents(
  state: ResearchCertificationStateV1,
  amendmentIds: readonly string[],
  revision: number,
): readonly CertificationAmendmentEvent[] | null {
  const activeIds = new Set<string>(activeCertificationAmendments(state).map((event) => event.amendment_id))
  if (new Set(amendmentIds).size !== amendmentIds.length || amendmentIds.some((id) => !activeIds.has(id))) return null
  return amendmentIds.map((amendmentId) => ({
    event_type: "RETRACTED",
    amendment_id: CertificationAmendmentIdSchema.parse(amendmentId),
    lifecycle: "RETRACTED",
    certification_revision: revision,
  }))
}

function allowsAmendment(state: ResearchCertificationStateV1): boolean {
  switch (state.status) {
    case "READY":
    case "AWAITING_HUMAN":
    case "BLOCKED":
      return true
    case "RUNNING":
    case "COMPLETE":
    case "ABORTED":
      return false
    default:
      return assertNever(state)
  }
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected certification amendment state: ${String(value)}`)
}
