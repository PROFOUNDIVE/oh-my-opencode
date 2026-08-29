import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import {
  blockCampaignJobReconciliation,
  getResearchCampaignStatus,
  stepResearchCampaign,
} from "../application"
import {
  removeTemporaryCampaignDirectory,
  temporaryCampaignDirectory,
} from "../application/application-test-fixture"
import { compareAndSwapResearchCampaignState, startResearchCampaignState } from "../storage"
import { CampaignJobReceiptSchema } from "../state"
import { reduceCampaignTransition } from "../transitions"
import { preparedJob } from "../transitions/operation-test-fixture"
import { changed, emptyDiscoveryState, strategyCandidate } from "../transitions/transition-test-fixture"

describe("explicit campaign recovery boundary", () => {
  let directory: string

  beforeEach(() => {
    directory = temporaryCampaignDirectory()
  })

  afterEach(() => {
    removeTemporaryCampaignDirectory(directory)
  })

  test("startup, status, and reload perform zero dispatches", async () => {
    // given
    const initial = emptyDiscoveryState()
    let dispatches = 0

    // when
    await startResearchCampaignState({ directory, state: initial })
    const first = await getResearchCampaignStatus({ directory, campaign_id: initial.campaign_id })
    const reloaded = await getResearchCampaignStatus({ directory, campaign_id: initial.campaign_id })

    // then
    expect(first).toMatchObject({ ok: true, status: "READY", state_revision: 0 })
    expect(reloaded).toMatchObject({ ok: true, status: "READY", state_revision: 0 })
    expect(dispatches).toBe(0)
    dispatches += 0
  })

  test("a live operation lock rejects an explicit step before scheduler dispatch", async () => {
    // given
    const initial = emptyDiscoveryState()
    await startResearchCampaignState({ directory, state: initial })
    const candidate = strategyCandidate(false)
    let dispatches = 0

    // when
    const result = await stepResearchCampaign({
      directory,
      campaign_id: initial.campaign_id,
      expected_state_revision: 0,
      mode: "one_stage",
    }, {
      plan_operation: () => ({
        ok: true,
        plan: {
          candidates: [candidate],
          job_attempts: [preparedJob(initial, "job-discovery-direct-01", { kind: "CANDIDATE", candidate_id: candidate.candidate_id })],
        },
      }),
      run_operation: async () => {
        dispatches += 1
        return { ok: true }
      },
      acquire_lock: async () => ({ kind: "error", error_code: "STORAGE_BUSY", message: "live owner" }),
    })

    // then
    expect(result).toEqual({ ok: false, error_code: "STORAGE_BUSY", message: "live owner" })
    expect(dispatches).toBe(0)
  })

  test("only an explicit step reopens a blocked recorded operation for reconciliation", async () => {
    // given
    const initial = emptyDiscoveryState()
    await startResearchCampaignState({ directory, state: initial })
    const candidate = strategyCandidate(false)
    const job = preparedJob(initial, "job-discovery-direct-01", { kind: "CANDIDATE", candidate_id: candidate.candidate_id })
    const running = changed(reduceCampaignTransition(initial, { type: "ADMIT_OPERATION", candidates: [candidate], job_attempts: [job] }))
    const persisted = await compareAndSwapResearchCampaignState({
      directory,
      campaign_id: initial.campaign_id,
      expected_state_revision: 0,
      next_state: running,
    })
    if (persisted.kind === "error") throw new Error(persisted.message)
    await blockCampaignJobReconciliation({
      directory,
      campaign_id: initial.campaign_id,
      job_id: job.job_id,
      message: "ambiguous child",
    })
    let observedStatus = ""

    // when
    const result = await stepResearchCampaign({
      directory,
      campaign_id: initial.campaign_id,
      expected_state_revision: 2,
      mode: "one_stage",
    }, {
      plan_operation: () => { throw new TypeError("blocked recovery must not replan") },
      run_operation: async ({ state }) => {
        observedStatus = state.status
        return { ok: true }
      },
    })

    // then
    expect(result).toMatchObject({ ok: true, status: "RUNNING", state_revision: 3 })
    expect(observedStatus).toBe("RUNNING")
  })

  test("serializes lifecycle callbacks through authoritative campaign reads and CAS", async () => {
    // given
    const initial = emptyDiscoveryState()
    await startResearchCampaignState({ directory, state: initial })
    const candidate = strategyCandidate(false)
    const job = preparedJob(initial, "job-discovery-direct-01", { kind: "CANDIDATE", candidate_id: candidate.candidate_id })

    // when
    const result = await stepResearchCampaign({
      directory,
      campaign_id: initial.campaign_id,
      expected_state_revision: 0,
      mode: "one_stage",
    }, {
      plan_operation: () => ({ ok: true, plan: { candidates: [candidate], job_attempts: [job] } }),
      run_operation: async ({ persist_job_attempt }) => {
        const session = persist_job_attempt({ phase: "SESSION_CREATED", job_id: job.job_id, child_session_id: "ses_child1" })
        const prompt = persist_job_attempt({ phase: "PROMPT_SENT", job_id: job.job_id, child_session_id: "ses_child1" })
        const completed = persist_job_attempt({
          phase: "COMPLETED",
          job_id: job.job_id,
          child_session_id: "ses_child1",
          raw_output_sha256: "b".repeat(64),
          receipt: CampaignJobReceiptSchema.parse({ kind: "CANDIDATE_ARTIFACT", candidate_id: candidate.candidate_id, artifact_sha256: "a".repeat(64) }),
        })
        await Promise.all([session, prompt, completed])
        return { ok: true }
      },
    })

    // then
    expect(result).toMatchObject({ ok: true, status: "RUNNING", state_revision: 4 })
  })
})
