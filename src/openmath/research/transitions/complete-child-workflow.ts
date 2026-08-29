import type { CandidateDescriptor, ResearchCampaignStateV1 } from "../state"
import { consumeApplicableCampaignAmendments } from "./amendment-state"
import { abortAfterCompletion, prepareOperationCompletion } from "./operation-jobs"
import { illegal, invalid, validated } from "./transition-result"
import type { CampaignTransitionEvent, CampaignTransitionResult } from "./types"

type ChildEvent = Extract<CampaignTransitionEvent, { readonly type: "COMPLETE_CHILD_WORKFLOW" }>

export function reduceCompleteChildWorkflow(
  state: ResearchCampaignStateV1,
  event: ChildEvent,
): CampaignTransitionResult {
  if (state.status !== "RUNNING" || state.phase !== "DEEP_REFINEMENT") {
    return illegal(state, "Child completion requires RUNNING deep refinement")
  }
  const completion = prepareOperationCompletion(state, event.job_attempts)
  if (!completion.ok) return completion.result
  const aborted = abortAfterCompletion(state, completion)
  if (aborted !== null) return aborted
  const common = {
    ...state,
    state_revision: completion.revision,
    active_job_ids: [],
    job_attempts: completion.committed_history,
    amendments: consumeApplicableCampaignAmendments(state, "DEEP_REFINEMENT", completion.revision),
  }
  switch (event.child_result.status) {
    case "PASSED": {
      const candidates = replaceSelection(state, event.child_result.candidate)
      if (candidates === null || !receiptMatchesCandidate(state, event, event.child_result.candidate)) {
        return invalid(state, "Passed child result must match the selected candidate receipt")
      }
      return validated(state, {
        ...common,
        phase: "PROMOTION",
        status: "READY",
        candidates,
      })
    }
    case "AWAITING_HUMAN": {
      const candidates = replaceSelection(state, event.child_result.candidate)
      if (candidates === null || !receiptMatchesCandidate(state, event, event.child_result.candidate)) {
        return invalid(state, "Child intervention must match the selected candidate receipt")
      }
      return validated(state, {
        ...common,
        status: "AWAITING_HUMAN",
        awaiting_reason: "CHILD_WORKFLOW_INTERVENTION",
        candidates,
      })
    }
    case "BLOCKED":
      return validated(state, { ...common, status: "BLOCKED", blocked_reason: event.child_result.reason })
    case "EXHAUSTED":
    case "ABORTED":
      return validated(state, { ...common, status: "REJECTED" })
    default:
      return assertNever(event.child_result)
  }
}

function replaceSelection(
  state: Extract<ResearchCampaignStateV1, { readonly status: "RUNNING" }>,
  candidate: CandidateDescriptor,
): readonly CandidateDescriptor[] | null {
  if (candidate.candidate_id !== state.selected_candidate_id) return null
  let found = false
  const candidates = state.candidates.map((current) => {
    if (current.candidate_id !== candidate.candidate_id) return current
    found = true
    return candidate
  })
  return found ? candidates : null
}

function receiptMatchesCandidate(
  state: Extract<ResearchCampaignStateV1, { readonly status: "RUNNING" }>,
  event: ChildEvent,
  candidate: CandidateDescriptor,
): boolean {
  if (event.job_attempts.length !== 1 || candidate.artifact === null) return false
  const job = event.job_attempts[0]
  const baseReceiptMatches = job?.phase === "COMPLETED"
    && job.target.kind === "CANDIDATE"
    && job.target.candidate_id === candidate.candidate_id
    && job.receipt.kind === "CANDIDATE_ARTIFACT"
    && job.receipt.artifact_sha256 === candidate.artifact.sha256
  if (!baseReceiptMatches || job.receipt.kind !== "CANDIDATE_ARTIFACT") return false
  const selected = state.candidates.find((current) => current.candidate_id === state.selected_candidate_id)
  if (selected?.artifact !== null && selected?.artifact !== undefined
    && sameArtifact(selected.artifact, candidate.artifact)) return true
  return job.receipt.refined_artifact !== undefined
    && sameArtifact(job.receipt.refined_artifact, candidate.artifact)
    && selectedPredecessorMatches(state, job.receipt.predecessor_artifact)
}

function selectedPredecessorMatches(
  state: Extract<ResearchCampaignStateV1, { readonly status: "RUNNING" }>,
  predecessor: CandidateDescriptor["artifact"] | undefined,
): boolean {
  const selected = state.candidates.find((candidate) => candidate.candidate_id === state.selected_candidate_id)
  if (selected === undefined) return false
  const artifact = selected.artifact
  if (artifact === null) return predecessor === undefined
  return predecessor !== undefined && predecessor !== null && sameArtifact(artifact, predecessor)
}

function sameArtifact(
  left: NonNullable<CandidateDescriptor["artifact"]>,
  right: NonNullable<CandidateDescriptor["artifact"]>,
): boolean {
  return left.child_run_id === right.child_run_id
    && left.child_state_revision === right.child_state_revision
    && left.artifact_version === right.artifact_version
    && left.media_type === right.media_type
    && left.sha256 === right.sha256
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected child workflow result: ${String(value)}`)
}
