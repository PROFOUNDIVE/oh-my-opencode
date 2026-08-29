import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import { stepResearchCampaign } from "../application"
import { buildCampaignSourceSnapshot } from "../application/build-campaign-source-snapshot"
import { createInitialCampaignState } from "../application/create-initial-campaign-state"
import {
  objectiveSnapshot,
  profileSnapshot,
  referenceSnapshot,
  removeTemporaryCampaignDirectory,
  temporaryCampaignDirectory,
} from "../application/application-test-fixture"
import type { CampaignJobRuntime } from "../scheduler"
import { readResearchCampaignState, startResearchCampaignState } from "../storage"
import { createCandidateDiscoveryStepDependencies } from "./candidate-discovery-operations"
import { FakeCandidateTransport } from "./candidate-discovery-test-runtime"

describe("candidate discovery batch recovery", () => {
  let directory: string

  beforeEach(() => {
    directory = temporaryCampaignDirectory()
  })

  afterEach(() => {
    removeTemporaryCampaignDirectory(directory)
  })

  test("waits for a delayed sibling after an unexpected rejection before recovery", async () => {
    // given
    const initial = createInitialCampaignState({
      campaign_id: "campaign-a",
      parent_session_id: "ses_parent",
      source_snapshot: buildCampaignSourceSnapshot({
        objective: objectiveSnapshot(),
        profile: profileSnapshot(),
        references: referenceSnapshot(),
      }),
    })
    const transport = new FakeCandidateTransport()
    const siblingEntered = deferred<void>()
    const releaseSibling = deferred<void>()
    const rejectionPersisted = deferred<void>()
    let rejectedDirectCompletion = false
    let activeToken: string | null = null
    let tokenSequence = 0
    const infrastructure: NonNullable<Parameters<typeof createCandidateDiscoveryStepDependencies>[0]["infrastructure"]> = {
      acquire_lock: async ({ operation_id }) => {
        if (activeToken !== null) return { kind: "error", error_code: "STORAGE_BUSY", message: "live owner" }
        activeToken = `token-${tokenSequence += 1}`
        return {
          kind: "acquired",
          owner: { token: activeToken, pid: 1, operation_id, started_at: "2026-08-28T00:00:00.000Z" },
          recovered_owner: null,
        }
      },
      release_lock: async ({ token }) => {
        if (token !== activeToken) return { kind: "error", error_code: "STORAGE_BUSY", message: "wrong owner" }
        activeToken = null
        return { kind: "ok" }
      },
    }
    const createRuntime = (callbacks: Pick<CampaignJobRuntime, "persist_job_attempt" | "block_reconciliation">): CampaignJobRuntime => {
      const runtime = transport.runtime(callbacks)
      return {
        ...runtime,
        dispatch: async (request) => {
          if (request.child_title.includes("contradiction-01")) {
            siblingEntered.resolve()
            await releaseSibling.promise
          }
          return runtime.dispatch(request)
        },
        persist_job_attempt: async (update) => {
          const persisted = await runtime.persist_job_attempt(update)
          if (!rejectedDirectCompletion && update.phase === "COMPLETED" && update.job_id.includes("direct-01")) {
            rejectedDirectCompletion = true
            await siblingEntered.promise
            rejectionPersisted.resolve()
            throw new TypeError("unexpected candidate completion rejection")
          }
          return persisted
        },
      }
    }
    const dependencies = createCandidateDiscoveryStepDependencies({ directory, create_job_runtime: createRuntime, infrastructure })
    await startResearchCampaignState({ directory, state: initial })

    // when
    const interrupted = stepResearchCampaign({
      directory,
      campaign_id: initial.campaign_id,
      expected_state_revision: 0,
      mode: "one_stage",
    }, dependencies).then(
      (value) => ({ kind: "fulfilled" as const, value }),
      (error: unknown) => {
        if (error instanceof Error) return { kind: "rejected" as const, reason: error.message }
        throw error
      },
    )
    await rejectionPersisted.promise
    for (let turn = 0; turn < 20; turn += 1) await Promise.resolve()
    const releasedBeforeSiblingSettled = activeToken === null
    const running = await campaignState(directory)
    const overlappingRecovery = stepResearchCampaign({
      directory,
      campaign_id: initial.campaign_id,
      expected_state_revision: running.state_revision,
      mode: "one_stage",
    }, dependencies)
    releaseSibling.resolve()
    const interruptedResult = await interrupted
    const overlapResult = await overlappingRecovery
    const recoverable = await campaignState(directory)
    const recovered = await stepResearchCampaign({
      directory,
      campaign_id: initial.campaign_id,
      expected_state_revision: recoverable.state_revision,
      mode: "one_stage",
    }, dependencies)
    const stored = await campaignState(directory)

    // then
    expect(releasedBeforeSiblingSettled).toBe(false)
    expect(interruptedResult).toEqual({ kind: "rejected", reason: "unexpected candidate completion rejection" })
    expect(overlapResult).toEqual({ ok: false, error_code: "STORAGE_BUSY", message: "live owner" })
    expect(recovered).toMatchObject({ ok: true, phase: "SCREENING", status: "READY" })
    expect(transport.requests).toHaveLength(2)
    expect(transport.createdSessionIds).toHaveLength(2)
    expect(new Set(transport.createdSessionIds).size).toBe(2)
    expect(transport.transcripts).toHaveLength(2)
    expect(transport.transcripts).toEqual(transport.requests.map((request) => `${request.prompt_marker}${request.user_prompt}`))
    expect(stored.candidates.map((candidate) => candidate.candidate_id)).toEqual(["direct-01", "contradiction-01"])
    expect(stored.job_attempts).toHaveLength(2)
    expect(stored.job_attempts.every((attempt) => attempt.phase === "COMMITTED" && attempt.receipt.kind === "CANDIDATE_ARTIFACT")).toBe(true)
  })
})

async function campaignState(directory: string) {
  const result = await readResearchCampaignState(directory, "campaign-a")
  if (result.kind === "error") throw new TypeError(result.message)
  return result.state
}

function deferred<T>() {
  let resolvePromise: (value: T | PromiseLike<T>) => void = () => undefined
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve
  })
  return { promise, resolve: resolvePromise }
}
