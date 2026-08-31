import { compareAndSwapCertificationGeneration } from "../storage"
import { reduceCertificationTransition, type CertificationTransitionEvent } from "../transitions"
import type { CertificationApplicationDependencies } from "./certification-application-dependencies"
import type { CertificationApplicationFailure, CertificationStateResult } from "./certification-application-types"
import { readResearchCertification } from "./read-research-certification"

type AmendmentOperation =
  | Omit<Extract<CertificationTransitionEvent, { readonly type: "ADD_AMENDMENT" }>, "type">
  | Omit<Extract<CertificationTransitionEvent, { readonly type: "RETRACT_AMENDMENT" }>, "type">

type AmendResearchCertificationInput = Readonly<{
  readonly directory: string
  readonly campaign_id: string
  readonly expected_state_revision: number
  readonly expected_certification_revision: number
}> & (
  | (Extract<AmendmentOperation, { readonly content: string }> & Readonly<{ readonly operation: "add" }>)
  | (Extract<AmendmentOperation, { readonly amendment_id: string }> & Readonly<{ readonly operation: "retract" }>)
)

export async function amendResearchCertification(
  input: AmendResearchCertificationInput,
  dependencies: CertificationApplicationDependencies = {},
): Promise<CertificationStateResult> {
  const current = await readResearchCertification(input, dependencies)
  if (current.kind === "disabled") return failure("CAMPAIGN_NOT_ELIGIBLE", "Certification is not enabled")
  if (current.kind === "error") return current
  if (current.context.campaign.state_revision !== input.expected_state_revision) {
    return {
      kind: "error",
      error_code: "STALE_STATE_REVISION",
      message: `Expected campaign revision ${input.expected_state_revision}, found ${current.context.campaign.state_revision}`,
      current_state_revision: current.context.campaign.state_revision,
    }
  }
  if (current.read.kind === "not_started") return failure("CERTIFICATION_NOT_FOUND", "Certification is not initialized")
  const transition = reduceCertificationTransition(
    current.read.state,
    amendmentEvent(input),
    input.expected_certification_revision,
  )
  if (!transition.ok) return failure(transition.error_code, transition.message)
  return (dependencies.compare_and_swap_generation ?? compareAndSwapCertificationGeneration)({
    directory: input.directory,
    identity: current.context.storage_identity,
    expected_certification_revision: input.expected_certification_revision,
    next_state: transition.state,
    campaign_guard: {
      expected_state_revision: input.expected_state_revision,
      expected_status: "READY",
    },
  })
}

function amendmentEvent(input: AmendResearchCertificationInput): CertificationTransitionEvent {
  switch (input.operation) {
    case "add":
      return { type: "ADD_AMENDMENT", kind: input.kind, scope: input.scope, content: input.content }
    case "retract":
      return { type: "RETRACT_AMENDMENT", amendment_id: input.amendment_id }
    default:
      return assertNever(input)
  }
}

function failure(
  errorCode: CertificationApplicationFailure["error_code"],
  message: string,
): CertificationApplicationFailure {
  return { kind: "error", error_code: errorCode, message }
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected certification amendment operation: ${String(value)}`)
}
