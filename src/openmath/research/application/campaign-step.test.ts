import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import { compareAndSwapResearchCampaignState, readResearchCampaignState, startResearchCampaignState } from "../storage"
import { reduceCampaignTransition } from "../transitions"
import { completedJob, preparedJob } from "../transitions/operation-test-fixture"
import { changed, emptyDiscoveryState, strategyCandidate } from "../transitions/transition-test-fixture"
import { abortResearchCampaign } from "./abort-research-campaign"
import {
  removeTemporaryCampaignDirectory,
  temporaryCampaignDirectory,
} from "./application-test-fixture"
import { getResearchCampaignStatus } from "./get-research-campaign-status"
import { stepResearchCampaign } from "./step-research-campaign"

describe("campaign step", () => {
  let directory: string

  beforeEach(() => {
    directory = temporaryCampaignDirectory()
  })

  afterEach(() => {
    removeTemporaryCampaignDirectory(directory)
  })

  test("persists RUNNING operation descriptors before scheduler side effects", async () => {
    // given
    const initial = emptyDiscoveryState()
    await startResearchCampaignState({ directory, state: initial })
    const plannedCandidate = strategyCandidate(false)
    const plan = {
      candidates: [plannedCandidate],
      job_attempts: [preparedJob(initial, "job-discovery-direct-01", { kind: "CANDIDATE", candidate_id: plannedCandidate.candidate_id })],
    }
    let observedState = initial

    // when
    const result = await stepResearchCampaign({
      directory,
      campaign_id: initial.campaign_id,
      expected_state_revision: 0,
      mode: "one_stage",
    }, {
      plan_operation: () => ({ ok: true, plan }),
      run_operation: async ({ state }) => {
        observedState = state
        return { ok: true }
      },
    })

    // then
    expect(observedState).toMatchObject({ status: "RUNNING", state_revision: 1, active_job_ids: ["job-discovery-direct-01"] })
    expect(result).toMatchObject({ ok: true, status: "RUNNING", state_revision: 1 })
  })

  test("status observes RUNNING without dispatch or repair", async () => {
    // given
    const initial = emptyDiscoveryState()
    await startResearchCampaignState({ directory, state: initial })
    const entered = deferred<void>()
    const release = deferred<void>()
    let runs = 0
    const step = stepResearchCampaign({ directory, campaign_id: initial.campaign_id, expected_state_revision: 0, mode: "one_stage" }, {
      plan_operation: () => ({ ok: true, plan: discoveryPlan(initial) }),
      run_operation: async () => {
        runs += 1
        entered.resolve()
        await release.promise
        return { ok: true }
      },
    })
    await entered.promise

    // when
    const status = await getResearchCampaignStatus({ directory, campaign_id: initial.campaign_id })

    // then
    expect(status).toMatchObject({ ok: true, status: "RUNNING", state_revision: 1 })
    expect(runs).toBe(1)
    release.resolve()
    await step
  })

  test("returns busy for a live operation owner with zero duplicate dispatch", async () => {
    // given
    const initial = emptyDiscoveryState()
    await startResearchCampaignState({ directory, state: initial })
    let runs = 0

    // when
    const result = await stepResearchCampaign({ directory, campaign_id: initial.campaign_id, expected_state_revision: 0, mode: "one_stage" }, {
      plan_operation: () => ({ ok: true, plan: discoveryPlan(initial) }),
      run_operation: async () => {
        runs += 1
        return { ok: true }
      },
      acquire_lock: async () => ({ kind: "error", error_code: "STORAGE_BUSY", message: "owned" }),
    })

    // then
    expect(result).toEqual({ ok: false, error_code: "STORAGE_BUSY", message: "owned" })
    expect(runs).toBe(0)
  })

  test("releases only the token acquired by this step", async () => {
    // given
    const initial = emptyDiscoveryState()
    await startResearchCampaignState({ directory, state: initial })
    const releasedTokens: string[] = []

    // when
    await stepResearchCampaign({ directory, campaign_id: initial.campaign_id, expected_state_revision: 0, mode: "one_stage" }, {
      plan_operation: () => ({ ok: true, plan: discoveryPlan(initial) }),
      run_operation: async () => ({ ok: true }),
      acquire_lock: async () => ({
        kind: "acquired",
        owner: { token: "own-token", pid: 1, operation_id: "campaign-1:operation:1", started_at: "2026-08-28T00:00:00.000Z" },
        recovered_owner: null,
      }),
      release_lock: async ({ token }) => {
        releasedTokens.push(token)
        return { kind: "ok" }
      },
    })

    // then
    expect(releasedTokens).toEqual(["own-token"])
  })

  test("reconciles RUNNING with the persisted operation identity", async () => {
    // given
    const initial = emptyDiscoveryState()
    await startResearchCampaignState({ directory, state: initial })
    const plan = discoveryPlan(initial)
    const running = changed(reduceCampaignTransition(initial, {
      type: "ADMIT_OPERATION",
      job_attempts: plan.job_attempts,
      candidates: plan.candidates,
    }))
    await compareAndSwapResearchCampaignState({
      directory,
      campaign_id: initial.campaign_id,
      expected_state_revision: 0,
      next_state: running,
    })
    const operationIds: string[] = []
    const recoveredOwners: unknown[] = []
    const recovered = { token: "dead-token", pid: 99, operation_id: "campaign-1:operation:1", started_at: "2026-08-28T00:00:00.000Z" }

    // when
    const result = await stepResearchCampaign({ directory, campaign_id: initial.campaign_id, expected_state_revision: 1, mode: "one_stage" }, {
      plan_operation: () => {
        throw new TypeError("reconciliation must not plan another operation")
      },
      run_operation: async ({ recovered_owner }) => {
        recoveredOwners.push(recovered_owner)
        return { ok: true }
      },
      acquire_lock: async ({ operation_id }) => {
        operationIds.push(operation_id)
        return {
          kind: "acquired",
          owner: { token: "new-token", pid: 1, operation_id, started_at: "2026-08-28T00:01:00.000Z" },
          recovered_owner: recovered,
        }
      },
      release_lock: async () => ({ kind: "ok" }),
    })

    // then
    expect(result).toMatchObject({ ok: true, status: "RUNNING", state_revision: 1 })
    expect(operationIds).toEqual(["campaign-1:operation:1"])
    expect(recoveredOwners).toEqual([recovered])
  })

  test("observes a concurrent abort before applying a completion result", async () => {
    // given
    const initial = emptyDiscoveryState()
    await startResearchCampaignState({ directory, state: initial })
    const entered = deferred<void>()
    const complete = deferred<void>()
    const plan = discoveryPlan(initial)
    const completedCandidate = strategyCandidate(true)
    const completedAttempt = completedJob(
      plan.job_attempts[0] ?? (() => { throw new TypeError("missing planned job") })(),
      3,
      { kind: "CANDIDATE_ARTIFACT", candidate_id: completedCandidate.candidate_id, artifact_sha256: completedCandidate.artifact?.sha256 ?? "" },
    )
    const step = stepResearchCampaign({ directory, campaign_id: initial.campaign_id, expected_state_revision: 0, mode: "one_stage" }, {
      plan_operation: () => ({ ok: true, plan }),
      run_operation: async ({ commit_transition }) => {
        entered.resolve()
        await complete.promise
        await commit_transition({ type: "COMPLETE_DISCOVERY", job_attempts: [completedAttempt], candidates: [completedCandidate] })
        const late = await commit_transition({ type: "COMPLETE_DISCOVERY", job_attempts: [completedAttempt], candidates: [completedCandidate] })
        expect(late).toMatchObject({ ok: true, status: "ABORTED", state_revision: 3 })
        return { ok: true }
      },
    })
    await entered.promise
    await abortResearchCampaign({ directory, campaign_id: initial.campaign_id, expected_state_revision: 1, reason: "human abort" })

    // when
    complete.resolve()
    const result = await step

    // then
    expect(result).toMatchObject({ ok: true, status: "ABORTED", state_revision: 3 })
    const stored = await readResearchCampaignState(directory, initial.campaign_id)
    expect(stored.kind).toBe("ok")
    if (stored.kind === "ok") {
      expect(stored.state.candidates[0]?.artifact).toBeNull()
      expect(stored.state.job_attempts[0]?.phase).toBe("COMPLETED")
    }
  })
})

function discoveryPlan(state: ReturnType<typeof emptyDiscoveryState>) {
  const candidate = strategyCandidate(false)
  return {
    candidates: [candidate],
    job_attempts: [preparedJob(state, "job-discovery-direct-01", { kind: "CANDIDATE", candidate_id: candidate.candidate_id })],
  }
}

function deferred<T>() {
  let resolvePromise: (value: T | PromiseLike<T>) => void = () => undefined
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve
  })
  return { promise, resolve: resolvePromise }
}
