import type { CampaignJobDispatch, CampaignJobLifecycleUpdate, CampaignJobRuntime } from "../scheduler"
import { buildCampaignSourceSnapshot } from "../application/build-campaign-source-snapshot"
import { createInitialCampaignState } from "../application/create-initial-campaign-state"
import {
  objectiveSnapshot,
  profileSnapshot,
  referenceSnapshot,
} from "../application/application-test-fixture"
import { stepResearchCampaign } from "../application"
import { createCandidateDiscoveryStepDependencies } from "../candidates/candidate-discovery-operations"
import { FakeCandidateTransport } from "../candidates/candidate-discovery-test-runtime"
import { createInitialScreeningStepDependencies } from "../screening/screening-operations"
import { FakeScreeningTransport } from "../screening/screening-test-runtime"
import { readResearchCampaignState, startResearchCampaignState } from "../storage"

export class FakeTournamentTransport {
  readonly requests: CampaignJobDispatch[] = []
  readonly transcripts = new Map<string, string>()
  preparedBeforeDispatch = true
  minimumScreenCountBeforeDispatch = Number.POSITIVE_INFINITY
  private nextSession = 500
  private outputIndex = 0
  private didCrash = false

  constructor(
    private readonly directory: string,
    private readonly outputs: readonly string[],
    private readonly crashAfterCompletion = false,
  ) {}

  runtime(callbacks: Pick<CampaignJobRuntime, "persist_job_attempt" | "block_reconciliation">): CampaignJobRuntime {
    return {
      ...callbacks,
      list_children: async () => [],
      get_session: async () => ({ title: "tournament" }),
      list_messages: async (sessionId) => [{ role: "user", text: this.transcripts.get(sessionId) ?? "" }],
      dispatch: async (request) => {
        const stored = await campaignState(this.directory)
        this.minimumScreenCountBeforeDispatch = Math.min(this.minimumScreenCountBeforeDispatch, stored.screen_receipts.length)
        this.preparedBeforeDispatch = this.preparedBeforeDispatch
          && stored.status === "RUNNING"
          && stored.active_job_ids.every((jobId) => stored.job_attempts.some((job) => job.job_id === jobId && job.phase === "PREPARED"))
        const sessionId = request.persisted_session_id ?? `ses_${this.nextSession}`
        this.nextSession += 1
        this.requests.push(request)
        await request.awaited_callbacks.on_session_created?.(sessionId)
        this.transcripts.set(sessionId, `${request.prompt_marker}${request.user_prompt}`)
        await request.awaited_callbacks.on_prompt_sent?.(sessionId)
        const output = this.outputs[this.outputIndex] ?? this.outputs[this.outputs.length - 1]
        this.outputIndex += 1
        if (output === undefined) return { ok: false, error: "Tournament output fixture is absent" }
        return { ok: true, session_id: sessionId, text: output }
      },
      persist_job_attempt: async (update) => this.persist(callbacks, update),
    }
  }

  private async persist(
    callbacks: Pick<CampaignJobRuntime, "persist_job_attempt">,
    update: CampaignJobLifecycleUpdate,
  ) {
    const result = await callbacks.persist_job_attempt(update)
    if (this.crashAfterCompletion && !this.didCrash && update.phase === "COMPLETED") {
      this.didCrash = true
      throw new Error("crash after persisted tournament completion")
    }
    return result
  }
}

export async function createScreenedCampaign(directory: string) {
  const profile = { ...profileSnapshot(), survivor_limit: 2 }
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

export async function campaignState(directory: string) {
  const result = await readResearchCampaignState(directory, "campaign-a")
  if (result.kind === "error") throw new Error(result.message)
  return result.state
}

export function keepOutput(): string {
  return JSON.stringify({
    kind: "DECIDED",
    actions: [
      { label: "entry-001", action: "KEEP" },
      { label: "entry-002", action: "DROP" },
    ],
    synthesis_brief: null,
  })
}
