import type { CandidateDescriptor, ResearchCampaignStateV1 } from "../state"
import { consumeApplicableCampaignAmendments } from "./amendment-state"
import { abortAfterCompletion, prepareOperationCompletion } from "./operation-jobs"
import { illegal, invalid, validated } from "./transition-result"
import type { CampaignTransitionEvent, CampaignTransitionResult } from "./types"

type DiscoveryEvent = Extract<CampaignTransitionEvent, { readonly type: "COMPLETE_DISCOVERY" }>

export function reduceCompleteDiscovery(
  state: ResearchCampaignStateV1,
  event: DiscoveryEvent,
): CampaignTransitionResult {
  if (state.status !== "RUNNING" || state.phase !== "DISCOVERY") {
    return illegal(state, "Discovery completion requires RUNNING discovery")
  }
  const completion = prepareOperationCompletion(state, event.job_attempts)
  if (!completion.ok) return completion.result
  const aborted = abortAfterCompletion(state, completion)
  if (aborted !== null) return aborted
  const replacements = new Map(event.candidates.map((candidate) => [candidate.candidate_id, candidate]))
  if (replacements.size !== state.active_job_ids.length) {
    return invalid(state, "Discovery completion requires one candidate per active job")
  }
  for (const job of event.job_attempts) {
    if (job.phase !== "COMPLETED" || job.target.kind !== "CANDIDATE" || job.receipt.kind !== "CANDIDATE_ARTIFACT") {
      return invalid(state, "Discovery jobs require candidate artifact receipts")
    }
    const candidate = replacements.get(job.target.candidate_id)
    if (candidate?.artifact === null || candidate?.artifact === undefined || candidate.artifact.sha256 !== job.receipt.artifact_sha256) {
      return invalid(state, "Discovery receipt must bind the completed candidate artifact")
    }
  }
  const candidates = replaceCandidates(state.candidates, replacements)
  if (candidates === null) return invalid(state, "Discovery may update only admitted candidates")
  return validated(state, {
    ...state,
    state_revision: completion.revision,
    phase: "SCREENING",
    status: "READY",
    active_job_ids: [],
    candidates,
    job_attempts: completion.committed_history,
    amendments: consumeApplicableCampaignAmendments(state, "DISCOVERY", completion.revision),
  })
}

function replaceCandidates(
  candidates: readonly CandidateDescriptor[],
  replacements: ReadonlyMap<string, CandidateDescriptor>,
): readonly CandidateDescriptor[] | null {
  const replaced = new Set<string>()
  const updated = candidates.map((candidate) => {
    const replacement = replacements.get(candidate.candidate_id)
    if (replacement === undefined) return candidate
    replaced.add(candidate.candidate_id)
    return replacement
  })
  return replaced.size === replacements.size ? updated : null
}
