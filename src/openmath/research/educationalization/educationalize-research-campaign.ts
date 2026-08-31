import { createInitialWorkflowState } from "../../workflow/transitions"
import { stepWorkflow } from "../../workflow/application/step-workflow"
import type { WorkflowStateV1 } from "../../workflow/state"
import type { StageRunnerRuntime } from "../../workflow/stage-runner"
import { readWorkflowState, startWorkflowState } from "../../workflow/storage"
import { sha256 } from "../../workflow/stage-runner/sha256"
import {
  validateApprovedEducationalSource,
  type ApprovedEducationalSource,
  type ApprovedEducationalSourceResult,
} from "./approved-source"
import { createEducationalReferenceSnapshot } from "./educational-reference-snapshot"
import { withEducationalizationLock } from "./educationalization-lock"

type EducationalizationInput = Readonly<{
  readonly directory: string
  readonly campaign_id: string
  readonly expected_state_revision: number
  readonly expected_certification_revision: number
  readonly dossier_sha256: string
  readonly parent_session_id: string
}>

type EducationalizationDependencies = Readonly<{
  readonly validate_source?: typeof validateApprovedEducationalSource
  readonly resolve_profile: () => Promise<WorkflowStateV1["profile_snapshot"]>
  readonly create_runtime: (state: WorkflowStateV1) => StageRunnerRuntime | undefined
}>

export type ResearchEducationalizationResult =
  | Readonly<{
      readonly ok: true
      readonly campaign_id: string
      readonly educationalization_id: string
      readonly status: "FROZEN"
      readonly artifact_sha256: string
      readonly state_revision: number
    }>
  | Readonly<{
      readonly ok: false
      readonly campaign_id: string
      readonly educationalization_id: string
      readonly error_code: string
      readonly message: string
      readonly state_revision?: number
    }>

export async function educationalizeResearchCampaign(
  input: EducationalizationInput,
  dependencies: EducationalizationDependencies,
): Promise<ResearchEducationalizationResult> {
  const educationalizationId = buildEducationalizationId(input.campaign_id, input.dossier_sha256)
  return withEducationalizationLock(
    educationalizationId,
    () => educationalizeLocked(input, dependencies, educationalizationId),
  )
}

async function educationalizeLocked(
  input: EducationalizationInput,
  dependencies: EducationalizationDependencies,
  educationalizationId: string,
): Promise<ResearchEducationalizationResult> {
  const validated = await (dependencies.validate_source ?? validateApprovedEducationalSource)(input)
  if (!validated.ok) return sourceFailure(input.campaign_id, educationalizationId, validated)
  const requestSnapshot = { kind: "research_educationalization" as const, ...validated.source }
  let current = await readWorkflowState(input.directory, educationalizationId)
  if (current.kind === "error") {
    if (current.error_code !== "RUN_NOT_FOUND") {
      return failure(input.campaign_id, educationalizationId, current.error_code, current.message)
    }
    const profile = await dependencies.resolve_profile()
    const initial = createInitialWorkflowState({
      run_id: educationalizationId,
      parent_session_id: input.parent_session_id,
      request_snapshot: requestSnapshot,
      profile_snapshot: profile,
      reference_snapshot: createEducationalReferenceSnapshot(
        validated.source.reference_solution,
        validated.source.reference_solution_sha256,
      ),
    })
    const started = await startWorkflowState({ directory: input.directory, state: initial })
    if (started.kind === "error" && started.error_code !== "RUN_ALREADY_EXISTS") {
      return failure(input.campaign_id, educationalizationId, started.error_code, started.message)
    }
    current = await readWorkflowState(input.directory, educationalizationId)
  }
  if (current.kind === "error") return failure(input.campaign_id, educationalizationId, current.error_code, current.message)
  if (JSON.stringify(current.state.request_snapshot) !== JSON.stringify(requestSnapshot)) {
    return failure(input.campaign_id, educationalizationId, "SOURCE_IDENTITY_MISMATCH", "Persisted educationalization source does not match the approved source")
  }
  if (current.state.status === "PASSED") return frozenResult(current.state)
  const runtime = dependencies.create_runtime(current.state)
  if (runtime === undefined) {
    return failure(input.campaign_id, educationalizationId, "SUBAGENT_FAILED", "OpenCode client is required to educationalize research")
  }
  const stepped = await stepWorkflow({
    directory: input.directory,
    run_id: educationalizationId,
    expected_state_revision: current.state.state_revision,
    mode: "to_checkpoint",
  }, {
    create_runtime: () => denyTools(runtime),
    validate_research_terminal: () => (dependencies.validate_source ?? validateApprovedEducationalSource)(input),
  })
  if (stepped.kind === "error") return failure(input.campaign_id, educationalizationId, stepped.error_code, stepped.message)
  if (stepped.state.status === "PASSED") {
    return frozenResult(stepped.state)
  }
  const adapterError = latestAdapterError(stepped.state)
  if (adapterError !== null) {
    return failure(input.campaign_id, educationalizationId, adapterError.code, adapterError.message, stepped.state.state_revision)
  }
  if (isSourceDefect(stepped.state)) {
    return failure(input.campaign_id, educationalizationId, "SOURCE_DEFECT", "Pedagogical review found a defect in the immutable mathematical source", stepped.state.state_revision)
  }
  return failure(input.campaign_id, educationalizationId, "PEDAGOGICAL_REVIEW_NOT_PASSED", `Educationalization stopped with status ${stepped.state.status}`, stepped.state.state_revision)
}

function buildEducationalizationId(campaignId: string, dossierSha256: string): string {
  return `research-education-${sha256(`${campaignId}\n${dossierSha256}`)}`
}

function denyTools(runtime: StageRunnerRuntime): StageRunnerRuntime {
  return { ...runtime, dispatch: (input) => runtime.dispatch({ ...input, tool_policy: "deny_all" }) }
}

function frozenResult(state: WorkflowStateV1): Extract<ResearchEducationalizationResult, { readonly ok: true }> {
  const artifact = state.artifact
  if (state.request_snapshot?.kind !== "research_educationalization" || artifact === null) {
    throw new TypeError("Passed research educationalization is missing provenance or artifacts")
  }
  return {
    ok: true,
    campaign_id: state.request_snapshot.campaign_id,
    educationalization_id: state.run_id,
    status: "FROZEN",
    artifact_sha256: artifact.sha256,
    state_revision: state.state_revision,
  }
}

function latestAdapterError(state: WorkflowStateV1) {
  const attempt = state.dispatch_attempts.at(-1)
  const receipt = attempt?.phase === "COMPLETED" || attempt?.phase === "COMMITTED" ? attempt.receipt : undefined
  return receipt?.kind === "ERROR" && receipt.error_code === "ADAPTER_OUTPUT_INVALID" ? receipt.adapter_error : null
}

function isSourceDefect(state: WorkflowStateV1): boolean {
  if (state.latest_review === null) return false
  try {
    const parsed: unknown = JSON.parse(state.latest_review.raw_report)
    return typeof parsed === "object" && parsed !== null && "verdict" in parsed && parsed.verdict === "SOURCE_DEFECT"
  } catch (error) {
    if (error instanceof SyntaxError) return false
    throw error
  }
}

function sourceFailure(campaignId: string, id: string, result: Exclude<ApprovedEducationalSourceResult, { readonly ok: true }>) {
  return failure(campaignId, id, result.error_code, result.message)
}

function failure(campaignId: string, id: string, errorCode: string, message: string, stateRevision?: number) {
  return { ok: false as const, campaign_id: campaignId, educationalization_id: id, error_code: errorCode, message, ...(stateRevision === undefined ? {} : { state_revision: stateRevision }) }
}
