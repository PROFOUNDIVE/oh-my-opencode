import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import { CampaignJobReceiptSchema, ResearchCampaignStateV1Schema, type ResearchCampaignStateV1 } from "../state"
import { compareAndSwapResearchCampaignState, startResearchCampaignState } from "../storage"
import { progressCampaignJobAttempt } from "../scheduler"
import { reduceCampaignTransition } from "../transitions"
import { preparedJob } from "../transitions/operation-test-fixture"
import { changed, emptyDiscoveryState, strategyCandidate } from "../transitions/transition-test-fixture"
import { removeTemporaryCampaignDirectory, temporaryCampaignDirectory } from "./application-test-fixture"
import { blockCampaignJobReconciliation, commitCampaignJobLifecycle } from "./commit-campaign-job-lifecycle"
import { reopenBlockedCampaignOperation } from "./reopen-blocked-campaign-operation"
import { stepResearchCampaign } from "./step-research-campaign"

describe("terminal campaign job retry", () => {
  let directory: string

  beforeEach(() => {
    directory = temporaryCampaignDirectory()
  })

  afterEach(() => {
    removeTemporaryCampaignDirectory(directory)
  })

  test("an explicit later step archives a transient terminal failure and activates one fresh durable retry", async () => {
    // given
    const blocked = await persistBlockedDispatchFailure(directory)
    let observed: ResearchCampaignStateV1 = blocked
    const children: string[] = []
    const messages: string[] = []
    let dispatches = 0
    let completions = 0

    // when
    const result = await stepResearchCampaign({
      directory,
      campaign_id: blocked.campaign_id,
      expected_state_revision: blocked.state_revision,
      mode: "one_stage",
    }, {
      plan_operation: () => { throw new TypeError("blocked recovery must not replan") },
      run_operation: async ({ state, persist_job_attempt, block_reconciliation }) => {
        observed = state
        const retry = state.job_attempts.find((attempt) => state.active_job_ids.includes(attempt.job_id))
        if (retry === undefined) throw new TypeError("Expected active retry")
        const progressed = await progressCampaignJobAttempt({
          parent_session_id: state.parent_session_id,
          attempt: retry,
          system_content: undefined,
          user_prompt: "retry payload",
          receipt_from_output: () => CampaignJobReceiptSchema.parse({ kind: "CANDIDATE_ARTIFACT", candidate_id: "direct-01", artifact_sha256: "a".repeat(64) }),
          runtime: {
            persist_job_attempt: async (update) => { if (update.phase === "COMPLETED") completions += 1; return persist_job_attempt(update) },
            block_reconciliation,
            list_children: async () => children.map((id) => ({ id })),
            get_session: async () => ({ title: retry.child_title }),
            list_messages: async () => messages.map((text) => ({ role: "user", text })),
            dispatch: async (request) => {
              dispatches += 1
              const sessionID = request.persisted_session_id ?? "ses_retry1"
              if (request.persisted_session_id === undefined) {
                children.push(sessionID)
                await request.awaited_callbacks.on_session_created?.(sessionID)
              }
              if (request.send_prompt) {
                messages.push(`${request.prompt_marker}${request.user_prompt}`)
                await request.awaited_callbacks.on_prompt_sent?.(sessionID)
              }
              return { ok: true, session_id: sessionID, text: "artifact output" }
            },
          },
        })
        if (progressed.kind !== "completed") throw new TypeError("Expected completed retry")
        return { ok: true }
      },
    })

    // then
    expect(result).toMatchObject({ ok: true, status: "RUNNING", state_revision: blocked.state_revision + 4 })
    expect(observed.job_attempts).toHaveLength(2)
    const failed = observed.job_attempts[0]
    const retry = observed.job_attempts[1]
    if (failed === undefined || retry === undefined) throw new TypeError("Expected failed and retry attempts")
    expect(failed).toMatchObject({
      job_id: "job-discovery-direct-01",
      phase: "COMMITTED",
      receipt: { kind: "ERROR", error_code: "SUBAGENT_FAILED", message: "transport failed" },
    })
    expect(retry).toMatchObject({
      phase: "PREPARED",
      attempt_number: 2,
      prepared_at_revision: blocked.state_revision + 1,
      target: failed.target,
    })
    expect(retry.job_id).not.toBe(failed.job_id)
    expect(retry.idempotency_key).not.toBe(failed.idempotency_key)
    expect(observed.active_job_ids).toEqual([retry.job_id])
    expect({ dispatches, children: children.length, prompts: messages.length, completions }).toEqual({ dispatches: 1, children: 1, prompts: 1, completions: 1 })
  })

  test("an explicit later step leaves a non-transient terminal failure blocked and releases its operation lock", async () => {
    // given
    const blocked = await persistBlockedDispatchFailure(directory, "ADAPTER_OUTPUT_INVALID")
    let runs = 0
    let releases = 0

    // when
    const result = await stepResearchCampaign({
      directory,
      campaign_id: blocked.campaign_id,
      expected_state_revision: blocked.state_revision,
      mode: "one_stage",
    }, {
      plan_operation: () => { throw new TypeError("blocked recovery must not replan") },
      run_operation: async () => {
        runs += 1
        return { ok: true }
      },
      acquire_lock: async ({ operation_id }) => ({
        kind: "acquired",
        owner: { token: "terminal-token", pid: 1, operation_id, started_at: "2026-08-28T00:00:00.000Z" },
        recovered_owner: null,
      }),
      release_lock: async () => {
        releases += 1
        return { kind: "ok" }
      },
    })

    // then
    expect(result).toMatchObject({ ok: false, error_code: "RECONCILIATION_BLOCKED" })
    expect(runs).toBe(0)
    expect(releases).toBe(1)
  })

  test("duplicate terminal failures for one target fail closed instead of creating ambiguous retries", async () => {
    // given
    const blocked = await persistBlockedDispatchFailure(directory)
    const failed = blocked.job_attempts[0]
    if (failed?.phase !== "COMPLETED") throw new TypeError("Expected completed failure")
    const duplicated = ResearchCampaignStateV1Schema.parse({
      ...blocked,
      job_attempts: [
        failed,
        {
          ...failed,
          job_id: "job-discovery-direct-01-duplicate",
          attempt_number: 2,
          prepared_at_revision: blocked.state_revision,
          phase_revision: blocked.state_revision,
          idempotency_key: "f".repeat(64),
          child_title: "duplicate failed campaign job",
          child_session_id: "ses_failed2",
        },
      ],
    })
    if (duplicated.status !== "BLOCKED") throw new TypeError("Expected blocked duplicate fixture")

    // when
    const result = reopenBlockedCampaignOperation(duplicated)

    // then
    expect(result).toEqual({ ok: false, message: "Blocked campaign has multiple retry candidates for one job target" })
  })
})

async function persistBlockedDispatchFailure(directory: string, errorCode = "SUBAGENT_FAILED"): Promise<Extract<ResearchCampaignStateV1, { readonly status: "BLOCKED" }>> {
  const initial = emptyDiscoveryState()
  await startResearchCampaignState({ directory, state: initial })
  const candidate = strategyCandidate(false)
  const job = preparedJob(initial, "job-discovery-direct-01", { kind: "CANDIDATE", candidate_id: candidate.candidate_id })
  const running = changed(reduceCampaignTransition(initial, {
    type: "ADMIT_OPERATION",
    candidates: [candidate],
    job_attempts: [job],
  }))
  const admitted = await compareAndSwapResearchCampaignState({
    directory,
    campaign_id: initial.campaign_id,
    expected_state_revision: initial.state_revision,
    next_state: running,
  })
  if (admitted.kind === "error") throw new TypeError(admitted.message)
  await commitCampaignJobLifecycle({
    directory,
    campaign_id: initial.campaign_id,
    update: { phase: "SESSION_CREATED", job_id: job.job_id, child_session_id: "ses_failed1" },
  })
  await commitCampaignJobLifecycle({
    directory,
    campaign_id: initial.campaign_id,
    update: { phase: "PROMPT_SENT", job_id: job.job_id, child_session_id: "ses_failed1" },
  })
  await commitCampaignJobLifecycle({
    directory,
    campaign_id: initial.campaign_id,
    update: {
      phase: "COMPLETED",
      job_id: job.job_id,
      child_session_id: "ses_failed1",
      raw_output_sha256: "e".repeat(64),
      receipt: CampaignJobReceiptSchema.parse({ kind: "ERROR", error_code: errorCode, message: "transport failed" }),
    },
  })
  const persisted = await blockCampaignJobReconciliation({
    directory,
    campaign_id: initial.campaign_id,
    job_id: job.job_id,
    message: "transport failed",
  })
  if (!persisted.ok || persisted.state.status !== "BLOCKED") throw new TypeError("Expected blocked campaign failure")
  return persisted.state
}
