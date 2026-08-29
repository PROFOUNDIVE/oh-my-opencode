import type { CampaignJobDispatch, CampaignJobLifecycleUpdate, CampaignJobRuntime } from "../scheduler"

const VALID_OUTPUT = JSON.stringify({
  verdict: "VIABLE",
  blocking_issues: [],
  unresolved_obligations: [],
  assumptions: [],
  novel_elements: [],
})

export class FakeScreeningTransport {
  readonly requests: CampaignJobDispatch[] = []
  readonly transcripts = new Map<string, string>()
  maxActive = 0
  private active = 0
  private nextSession = 100
  private didCrash = false

  constructor(
    private readonly malformedFirst = false,
    private readonly crashAfterFirstCompletion = false,
  ) {}

  runtime(callbacks: Pick<CampaignJobRuntime, "persist_job_attempt" | "block_reconciliation">): CampaignJobRuntime {
    return {
      block_reconciliation: callbacks.block_reconciliation,
      persist_job_attempt: async (update) => this.persist(callbacks, update),
      list_children: async () => [],
      get_session: async () => ({ title: "screen" }),
      list_messages: async (sessionId) => [{ role: "user", text: this.transcripts.get(sessionId) ?? "" }],
      dispatch: async (request) => {
        const index = this.requests.length
        const sessionId = request.persisted_session_id ?? `ses_${this.nextSession}`
        this.nextSession += 1
        this.requests.push(request)
        this.active += 1
        this.maxActive = Math.max(this.maxActive, this.active)
        await request.awaited_callbacks.on_session_created?.(sessionId)
        this.transcripts.set(sessionId, `${request.prompt_marker}${request.user_prompt}`)
        await request.awaited_callbacks.on_prompt_sent?.(sessionId)
        await Promise.resolve()
        this.active -= 1
        return {
          ok: true,
          session_id: sessionId,
          text: this.malformedFirst && index === 0 ? "not-json" : VALID_OUTPUT,
        }
      },
    }
  }

  private async persist(
    callbacks: Pick<CampaignJobRuntime, "persist_job_attempt">,
    update: CampaignJobLifecycleUpdate,
  ) {
    const result = await callbacks.persist_job_attempt(update)
    if (this.crashAfterFirstCompletion && !this.didCrash && update.phase === "COMPLETED") {
      this.didCrash = true
      throw new Error("crash after persisted screen completion")
    }
    return result
  }
}
