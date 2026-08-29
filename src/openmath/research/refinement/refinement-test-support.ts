import type { CampaignJobDispatch, CampaignJobRuntime } from "../scheduler"
import { stepResearchCampaign } from "../application"
import { buildCampaignSourceSnapshot } from "../application/build-campaign-source-snapshot"
import { createInitialCampaignState } from "../application/create-initial-campaign-state"
import { objectiveSnapshot, profileSnapshot, referenceSnapshot } from "../application/application-test-fixture"
import { createCandidateDiscoveryStepDependencies } from "../candidates/candidate-discovery-operations"
import { FakeCandidateTransport } from "../candidates/candidate-discovery-test-runtime"
import { createInitialScreeningStepDependencies } from "../screening/screening-operations"
import { FakeScreeningTransport } from "../screening/screening-test-runtime"
import { startResearchCampaignState } from "../storage"
import { createTournamentStepDependencies } from "../tournament/tournament-operations"
import {
  campaignState,
  createScreenedCampaign,
  FakeTournamentTransport,
  keepOutput,
} from "../tournament/tournament-operation.test-support"

export class FakeRefinementTransport {
  readonly requests: CampaignJobDispatch[] = []
  readonly transcripts = new Map<string, string>()
  private nextSession = 900
  private outputIndex = 0

  constructor(private readonly outputs: readonly string[]) {}

  runtime(callbacks: Pick<CampaignJobRuntime, "persist_job_attempt" | "block_reconciliation">): CampaignJobRuntime {
    return {
      ...callbacks,
      list_children: async () => [],
      get_session: async () => ({ title: "refinement" }),
      list_messages: async (sessionId) => [{ role: "user", text: this.transcripts.get(sessionId) ?? "" }],
      dispatch: async (request) => {
        const sessionId = request.persisted_session_id ?? `ses_${this.nextSession}`
        this.nextSession += 1
        this.requests.push(request)
        await request.awaited_callbacks.on_session_created?.(sessionId)
        this.transcripts.set(sessionId, `${request.prompt_marker}${request.user_prompt}`)
        await request.awaited_callbacks.on_prompt_sent?.(sessionId)
        const output = this.outputs[this.outputIndex]
        this.outputIndex += 1
        return output === undefined
          ? { ok: false, error: "Refinement output fixture is absent" }
          : { ok: true, session_id: sessionId, text: output }
      },
    }
  }
}

export async function createKeepSelection(directory: string, maxReviewRounds = 2) {
  const checkpoint = maxReviewRounds === 2
    ? await createScreenedCampaign(directory)
    : await createScreenedCampaignWithReviewLimit(directory, maxReviewRounds)
  const tournament = new FakeTournamentTransport(directory, [keepOutput()])
  const selected = await stepResearchCampaign({
    directory,
    campaign_id: "campaign-a",
    expected_state_revision: checkpoint.state_revision,
    mode: "one_stage",
  }, createTournamentStepDependencies({
    directory,
    create_job_runtime: (callbacks) => tournament.runtime(callbacks),
  }))
  if (!selected.ok) throw new Error(selected.message)
  return campaignState(directory)
}

async function createScreenedCampaignWithReviewLimit(directory: string, maxReviewRounds: number) {
  const baseProfile = profileSnapshot()
  const profile = {
    ...baseProfile,
    survivor_limit: 2,
    candidate_workflow_profile: { ...baseProfile.candidate_workflow_profile, max_review_rounds: maxReviewRounds },
  }
  const initial = createInitialCampaignState({
    campaign_id: "campaign-a",
    parent_session_id: "ses_parent",
    source_snapshot: buildCampaignSourceSnapshot({
      objective: objectiveSnapshot(),
      profile,
      references: referenceSnapshot(),
    }),
  })
  await startResearchCampaignState({ directory, state: initial })
  const discovery = new FakeCandidateTransport(false, directory)
  const discovered = await stepResearchCampaign({
    directory, campaign_id: "campaign-a", expected_state_revision: 0, mode: "one_stage",
  }, createCandidateDiscoveryStepDependencies({
    directory,
    create_job_runtime: (callbacks) => discovery.runtime(callbacks),
  }))
  if (!discovered.ok) throw new Error(discovered.message)
  const screening = new FakeScreeningTransport()
  const screened = await stepResearchCampaign({
    directory, campaign_id: "campaign-a", expected_state_revision: discovered.state_revision, mode: "one_stage",
  }, createInitialScreeningStepDependencies({
    directory,
    create_job_runtime: (callbacks) => screening.runtime(callbacks),
  }))
  if (!screened.ok) throw new Error(screened.message)
  return campaignState(directory)
}

export async function createMergeSelection(directory: string) {
  const checkpoint = await createScreenedCampaign(directory)
  const brief = "Combine the two surviving methods without parent artifact bytes."
  const tournament = new FakeTournamentTransport(directory, [JSON.stringify({
    kind: "DECIDED",
    actions: [
      { label: "entry-001", action: "MERGE_IDEA" },
      { label: "entry-002", action: "MERGE_IDEA" },
    ],
    synthesis_brief: brief,
  })])
  const selected = await stepResearchCampaign({
    directory,
    campaign_id: "campaign-a",
    expected_state_revision: checkpoint.state_revision,
    mode: "one_stage",
  }, createTournamentStepDependencies({
    directory,
    create_job_runtime: (callbacks) => tournament.runtime(callbacks),
  }))
  if (!selected.ok) throw new Error(selected.message)
  return campaignState(directory)
}

export function reviewOutput(verdict: "[CORRECT]" | "[ERROR]" | "[INCONCLUSIVE]"): string {
  return JSON.stringify({
    verdict,
    certificate: { artifact_version: "v1", review_round: 1, timestamp: "2026-08-28T00:00:00.000Z" },
  })
}
