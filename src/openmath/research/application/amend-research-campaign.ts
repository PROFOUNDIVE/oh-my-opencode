import { amendWorkflow } from "../../workflow/application/amend-workflow"
import { getWorkflowStatus } from "../../workflow/application/get-workflow-status"
import { amendResearchCertification } from "../certification/application/amend-research-certification"
import type { CertificationApplicationDependencies } from "../certification/application/certification-application-dependencies"
import { CertificationAmendmentScopeSchema } from "../certification/state/amendments"
import { hashResearchCertificationState } from "../certification/state/schema"
import { CampaignAmendmentScopeSchema, type ResearchCampaignStateV1 } from "../state"
import { readResearchCampaignState } from "../storage"
import { reduceCampaignTransition, type CampaignAmendmentKind, type CampaignTransitionEvent } from "../transitions"
import { campaignErrorEnvelope } from "./campaign-envelope"
import type { CampaignStateResult, PublicCampaignApplicationResult } from "./campaign-application-result"
import { certificationEnabled } from "./campaign-lifecycle-envelope"
import type { CampaignMutationDependencies } from "./campaign-mutation-dependencies"
import { writeCampaignTransition } from "./commit-campaign-transition"
import { stateResultEnvelope } from "./state-result-envelope"
import { enabledCampaignErrorEnvelope } from "./enabled-campaign-error-envelope"
import { enabledCampaignSuccessEnvelope } from "./enabled-campaign-envelope"

type SelectedRefinementResult =
  | { readonly kind: "ok" }
  | { readonly kind: "error"; readonly error_code: string; readonly message: string }

type AmendResearchCampaignDependencies = CampaignMutationDependencies & CertificationApplicationDependencies & Readonly<{
  readonly get_workflow_status?: typeof getWorkflowStatus
  readonly amend_workflow?: (input: Readonly<{
    readonly directory: string
    readonly run_id: string
    readonly expected_state_revision: number
    readonly operation: "add"
    readonly kind: CampaignAmendmentKind
    readonly scope: "all_remaining"
    readonly content: string
  }>) => Promise<SelectedRefinementResult>
}>

type AmendResearchCampaignInput = Readonly<{
  readonly directory: string
  readonly campaign_id: string
  readonly expected_state_revision: number
  readonly expected_certification_revision?: number
}> & (
  | Readonly<{
      readonly operation: "add"
      readonly kind: CampaignAmendmentKind
      readonly scope: string
      readonly content: string
    }>
  | Readonly<{ readonly operation: "retract"; readonly amendment_id: string }>
)

export async function amendResearchCampaign(
  input: AmendResearchCampaignInput,
  dependencies: AmendResearchCampaignDependencies = {},
): Promise<PublicCampaignApplicationResult> {
  const current = await (dependencies.read_state ?? dependencies.read_campaign ?? readResearchCampaignState)(input.directory, input.campaign_id)
  if (current.kind === "error") return campaignErrorEnvelope(current)
  if (current.state.state_revision !== input.expected_state_revision) {
    const stale = {
      error_code: "STALE_STATE_REVISION" as const,
      message: `Expected revision ${input.expected_state_revision}, found ${current.state.state_revision}`,
      current_state_revision: current.state.state_revision,
    }
    return certificationEnabled(current.state)
      ? enabledCampaignErrorEnvelope(stale)
      : stateResultEnvelope({ kind: "error", ...stale })
  }
  if (certificationEnabled(current.state)) {
    return amendEnabledCampaign(input, current.state, dependencies)
  }
  if (input.expected_certification_revision !== undefined) {
    return campaignErrorEnvelope({ error_code: "VALIDATION_ERROR", message: "Certification revision is not accepted for a Phase A campaign" })
  }
  const event = amendmentEvent(input)
  if (event === null) {
    return campaignErrorEnvelope({ error_code: "VALIDATION_ERROR", message: "Amendment scope must match the Phase A contract" })
  }
  const transition = reduceCampaignTransition(current.state, event)
  if (!transition.ok) return campaignErrorEnvelope({ error_code: transition.error_code, message: transition.message })
  const written = await writeCampaignTransition(input, transition.state, dependencies)
  if (written.kind === "error") return stateResultEnvelope(written)
  if (event.type === "ADD_AMENDMENT" && event.scope === "selected_refinement") {
    const forwarded = await forwardSelectedRefinement(input.directory, current.state, event, dependencies)
    if (forwarded.kind === "error") return stateResultEnvelope(forwarded)
  }
  return stateResultEnvelope(written)
}

async function amendEnabledCampaign(
  input: AmendResearchCampaignInput,
  campaign: ResearchCampaignStateV1,
  dependencies: AmendResearchCampaignDependencies,
): Promise<PublicCampaignApplicationResult> {
  if (input.expected_certification_revision === undefined) {
    return enabledCampaignErrorEnvelope({ error_code: "VALIDATION_ERROR", message: "Expected certification revision is required" })
  }
  const scope = input.operation === "add" ? CertificationAmendmentScopeSchema.safeParse(input.scope) : null
  if (input.operation === "add" && (scope === null || !scope.success)) {
    return enabledCampaignErrorEnvelope({ error_code: "VALIDATION_ERROR", message: "Amendment scope must match the certification contract" })
  }
  const request = input.operation === "add" && scope?.success === true
    ? { ...input, scope: scope.data, expected_certification_revision: input.expected_certification_revision }
    : { ...input, expected_certification_revision: input.expected_certification_revision }
  const result = await amendResearchCertification(request, {
    ...dependencies,
    read_campaign: async () => ({ kind: "ok", state: campaign }),
  })
  if (result.kind === "error") {
    return enabledCampaignErrorEnvelope({
      ...result,
      error_code: result.error_code === "CAMPAIGN_ABORTED" ? "ABORTED" : result.error_code,
    })
  }
  return enabledCampaignSuccessEnvelope(campaign, {
    kind: "readable",
    state: result.state,
    content_sha256: hashResearchCertificationState(result.state),
    effective_status: result.state.status,
  })
}

function amendmentEvent(input: AmendResearchCampaignInput): CampaignTransitionEvent | null {
  switch (input.operation) {
    case "add": {
      const scope = CampaignAmendmentScopeSchema.safeParse(input.scope)
      return scope.success ? { type: "ADD_AMENDMENT", kind: input.kind, scope: scope.data, content: input.content } : null
    }
    case "retract":
      return { type: "RETRACT_AMENDMENT", amendment_id: input.amendment_id }
    default:
      return assertNever(input)
  }
}

async function forwardSelectedRefinement(
  directory: string,
  state: ResearchCampaignStateV1,
  event: Extract<CampaignTransitionEvent, { readonly type: "ADD_AMENDMENT" }>,
  dependencies: AmendResearchCampaignDependencies,
): Promise<CampaignStateResult> {
  const selected = state.candidates.find((candidate) => candidate.candidate_id === state.selected_candidate_id)
  if (selected === undefined || selected.child_state_revision === null) {
    return { kind: "error", error_code: "CHILD_WORKFLOW_FAILED", message: "Selected child workflow is unavailable" }
  }
  let childRevision = selected.child_state_revision
  if (dependencies.get_workflow_status !== undefined || dependencies.amend_workflow === undefined) {
    const child = await (dependencies.get_workflow_status ?? getWorkflowStatus)({ directory, run_id: selected.child_run_id })
    if (child.kind === "error") {
      return { kind: "error", error_code: "CHILD_WORKFLOW_FAILED", message: child.message }
    }
    childRevision = child.state.state_revision
  }
  const result = await (dependencies.amend_workflow ?? amendWorkflow)({
    directory,
    run_id: selected.child_run_id,
    expected_state_revision: childRevision,
    operation: "add",
    kind: event.kind,
    scope: "all_remaining",
    content: event.content,
  })
  return result.kind === "ok"
    ? { kind: "ok", state }
    : { kind: "error", error_code: "CHILD_WORKFLOW_FAILED", message: result.message }
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected campaign amendment operation: ${String(value)}`)
}
