import type { CampaignJobDispatch, CampaignJobRuntime } from "../scheduler"
import { readResearchCampaignState } from "../storage"

export class FakeCandidateTransport {
  static readonly secret = "CANDIDATE_A_SECRET_SENTINEL"
  readonly requests: CampaignJobDispatch[] = []
  readonly transcripts: string[] = []
  readonly createdSessionIds: string[] = []
  maxActive = 0
  preparedBeforeDispatch = true
  private active = 0
  private nextSession = 1
  private readonly transcriptBySession = new Map<string, string>()

  constructor(
    private readonly failFirst = false,
    private readonly directory?: string,
  ) {}

  runtime(callbacks: Pick<CampaignJobRuntime, "persist_job_attempt" | "block_reconciliation">): CampaignJobRuntime {
    return {
      ...callbacks,
      list_children: async () => [],
      get_session: async () => ({ title: "candidate" }),
      list_messages: async (sessionID) => [{ role: "user", text: this.transcriptBySession.get(sessionID) ?? "" }],
      dispatch: async (request) => {
        if (this.directory !== undefined && this.requests.length === 0) {
          const persisted = await readResearchCampaignState(this.directory, "campaign-a")
          this.preparedBeforeDispatch = this.preparedBeforeDispatch && persisted.kind === "ok"
            && persisted.state.status === "RUNNING"
            && persisted.state.job_attempts.every((job) => job.phase === "PREPARED")
        }
        const index = this.requests.length
        const sessionId = request.persisted_session_id ?? `ses_${this.nextSession}`
        if (request.persisted_session_id === undefined) {
          this.nextSession += 1
          this.createdSessionIds.push(sessionId)
        }
        this.requests.push(request)
        this.active += 1
        this.maxActive = Math.max(this.maxActive, this.active)
        await request.awaited_callbacks.on_session_created?.(sessionId)
        this.transcripts[index] = `${request.prompt_marker}${request.user_prompt}`
        this.transcriptBySession.set(sessionId, this.transcripts[index] ?? "")
        await request.awaited_callbacks.on_prompt_sent?.(sessionId)
        await Promise.resolve()
        this.active -= 1
        if (this.failFirst && index === 0) return { ok: false, error: "candidate failed" }
        return {
          ok: true,
          session_id: sessionId,
          text: request.child_title.includes("direct-01") ? FakeCandidateTransport.secret : `# candidate ${index + 1}`,
        }
      },
    }
  }
}
