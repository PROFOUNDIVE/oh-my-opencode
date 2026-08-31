import type { ResearchCertificationStateV1 } from "../state/schema"
import {
  reduceAddCertificationAmendment,
  reduceConsumeCertificationAmendments,
  reduceRetractCertificationAmendment,
} from "./amendments"
import { reduceCommitCertificationAttacks } from "./attack-transition"
import { reduceCompleteCertification } from "./complete"
import { reduceCommitCertificationCoverage } from "./coverage-transition"
import { reduceCommitCertificationExtraction } from "./extraction-transition"
import { reducePrepareCertificationOperation } from "./operation-jobs"
import { reduceCommitCertificationWitnesses } from "./witness-transition"
import { certificationFailure, certificationSuccess } from "./transition-result"
import type { CertificationTransitionEvent, CertificationTransitionResult } from "./types"

export function reduceCertificationTransition(
  state: ResearchCertificationStateV1,
  event: CertificationTransitionEvent,
  expectedCertificationRevision: number,
): CertificationTransitionResult {
  if (state.status === "ABORTED" || state.status === "COMPLETE") {
    return certificationFailure(state, "ILLEGAL_TRANSITION", "Terminal certification states are immutable")
  }
  if (state.certification_revision !== expectedCertificationRevision) {
    return certificationFailure(
      state,
      "STALE_CERTIFICATION_REVISION",
      `Expected certification revision ${expectedCertificationRevision}, found ${state.certification_revision}`,
    )
  }
  switch (event.type) {
    case "CHECK_ARTIFACT":
      return JSON.stringify(event.observed_selected_artifact) === JSON.stringify(state.selected_artifact)
        ? { ok: true, state }
        : certificationFailure(state, "STALE_ARTIFACT", "Selected artifact identity is stale")
    case "ABORT":
      return certificationSuccess(state, {
        ...state,
        certification_revision: state.certification_revision + 1,
        status: "ABORTED",
        awaiting_reason: null,
        abort_requested: true,
        abort_reason: event.reason,
        blocked_reason: null,
        active_job_ids: [],
        job_attempts: state.job_attempts.filter((job) => job.phase === "COMMITTED"),
      })
    case "BLOCK":
      return certificationSuccess(state, {
        ...state,
        certification_revision: state.certification_revision + 1,
        status: "BLOCKED",
        awaiting_reason: null,
        abort_requested: false,
        abort_reason: null,
        blocked_reason: event.reason,
        active_job_ids: [],
        job_attempts: state.job_attempts.filter((job) => job.phase === "COMMITTED"),
      })
    case "ADD_AMENDMENT":
      return reduceAddCertificationAmendment(state, event)
    case "RETRACT_AMENDMENT":
      return reduceRetractCertificationAmendment(state, event)
    case "CONSUME_AMENDMENTS":
      return reduceConsumeCertificationAmendments(state, event)
    case "PREPARE_OPERATION":
      return reducePrepareCertificationOperation(state, event)
    case "COMMIT_EXTRACTION":
      return reduceCommitCertificationExtraction(state, event)
    case "COMMIT_COVERAGE":
      return reduceCommitCertificationCoverage(state, event)
    case "COMMIT_ATTACKS":
      return reduceCommitCertificationAttacks(state, event)
    case "COMMIT_WITNESSES":
      return reduceCommitCertificationWitnesses(state, event)
    case "COMPLETE":
      return reduceCompleteCertification(state, event)
    default:
      return assertNever(event)
  }
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected certification transition event: ${String(value)}`)
}
