import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import {
  acquireResearchCampaignOperationLock,
  getResearchCampaignDirectory,
  readResearchCampaignOperationLock,
  releaseResearchCampaignOperationLock,
  startResearchCampaignState,
} from "../storage"
import { ResearchCampaignLockCleanupError } from "../storage/lock-cleanup-error"
import { preparedJob } from "../transitions/operation-test-fixture"
import { emptyDiscoveryState, strategyCandidate } from "../transitions/transition-test-fixture"
import {
  removeTemporaryCampaignDirectory,
  temporaryCampaignDirectory,
} from "./application-test-fixture"
import { stepResearchCampaign } from "./step-research-campaign"
import { runCampaignOperation } from "./run-campaign-operation"

describe("campaign operation cleanup failure", () => {
  let directory: string

  beforeEach(() => {
    directory = temporaryCampaignDirectory()
  })

  afterEach(() => {
    removeTemporaryCampaignDirectory(directory)
  })

  test("exposes both the scheduler failure and failed durable operation-lock release", async () => {
    // given
    const primaryMessage = "Injected scheduler failure"

    // when
    const result = runOperationWithFailedCleanup(directory, primaryMessage)

    // then
    await expect(result).rejects.toMatchObject({
      name: "ResearchCampaignLockCleanupError",
      operation_error: { name: "TypeError", message: primaryMessage },
      cleanup_failure: {
        kind: "error",
        error_code: "STORAGE_WRITE_FAILED",
        message: "Injected operation lock release failure",
      },
    })
    const lock = await readResearchCampaignOperationLock(getResearchCampaignDirectory(directory, "campaign-1"))
    expect(lock).toMatchObject({ kind: "owned", process_status: "live" })
  })

  test("does not let a non-owner release a live lock after failed cleanup", async () => {
    // given
    const campaignDirectory = await strandLiveOperationLock(directory, "Injected scheduler failure")
    const lockPath = join(campaignDirectory, ".operation.lock")
    const ownerBytes = readFileSync(lockPath, "utf8")

    // when
    const released = await releaseResearchCampaignOperationLock({
      campaign_directory: campaignDirectory,
      token: "non-owner-token",
    })

    // then
    expect(released).toMatchObject({ kind: "error", error_code: "STORAGE_BUSY" })
    expect(readFileSync(lockPath, "utf8")).toBe(ownerBytes)
  })

  test("does not let a contender replace a live lock after failed cleanup", async () => {
    // given
    const campaignDirectory = await strandLiveOperationLock(directory, "Injected scheduler failure")
    const lockPath = join(campaignDirectory, ".operation.lock")
    const ownerBytes = readFileSync(lockPath, "utf8")

    // when
    const acquired = await acquireResearchCampaignOperationLock({
      campaign_directory: campaignDirectory,
      operation_id: "campaign-1:operation:2",
    })

    // then
    expect(acquired).toMatchObject({ kind: "error", error_code: "STORAGE_BUSY" })
    expect(readFileSync(lockPath, "utf8")).toBe(ownerBytes)
  })

  test("retains error identity and cause when the release callback throws", async () => {
    // given
    const operationError = new TypeError("Injected scheduler identity failure")
    const cleanupError = new RangeError("Injected release callback failure")

    // when
    const result = runOperationWithThrownCleanup(directory, operationError, cleanupError)

    // then
    try {
      await result
      throw new TypeError("Campaign operation unexpectedly completed")
    } catch (error) {
      expect(error).toBeInstanceOf(ResearchCampaignLockCleanupError)
      if (!(error instanceof ResearchCampaignLockCleanupError)) return
      expect(error.operation_error).toBe(operationError)
      expect(error.cleanup_error).toBe(cleanupError)
      expect(error.cleanup_failure).toEqual({
        kind: "error",
        error_code: "STORAGE_WRITE_FAILED",
        message: "Durable research campaign lock cleanup threw unexpectedly",
      })
    }
  })

  test("retains a returned scheduler error when operation-lock release also fails", async () => {
    // given
    const state = emptyDiscoveryState()
    await startResearchCampaignState({ directory, state })

    // when
    const result = await runCampaignOperation({
      directory,
      campaign_id: state.campaign_id,
      state_revision: 0,
      operation_revision: 1,
    }, {
      plan_operation: () => ({
        ok: true,
        plan: {
          candidates: [strategyCandidate(false)],
          job_attempts: [preparedJob(state, "job-discovery-direct-01", { kind: "CANDIDATE", candidate_id: "direct-01" })],
        },
      }),
      run_operation: async () => ({ ok: false, error_code: "SUBAGENT_FAILED", message: "Injected returned scheduler failure" }),
      release_lock: async () => ({
        kind: "error",
        error_code: "STORAGE_WRITE_FAILED",
        message: "Injected operation lock release failure",
      }),
    })

    // then
    expect(result).toMatchObject({
      kind: "error",
      error_code: "SUBAGENT_FAILED",
      message: "Injected returned scheduler failure",
      cleanup_failure: {
        kind: "error",
        error_code: "STORAGE_WRITE_FAILED",
        message: "Injected operation lock release failure",
      },
    })
  })
})

async function strandLiveOperationLock(directory: string, primaryMessage: string): Promise<string> {
  try {
    await runOperationWithFailedCleanup(directory, primaryMessage)
  } catch (error) {
    if (!(error instanceof Error) || error.name !== "ResearchCampaignLockCleanupError") throw error
  }
  return getResearchCampaignDirectory(directory, "campaign-1")
}

async function runOperationWithFailedCleanup(directory: string, primaryMessage: string): Promise<never> {
  const state = emptyDiscoveryState()
  await startResearchCampaignState({ directory, state })
  const candidate = strategyCandidate(false)
  return stepResearchCampaign({
    directory,
    campaign_id: state.campaign_id,
    expected_state_revision: 0,
    mode: "one_stage",
  }, {
    plan_operation: () => ({
      ok: true,
      plan: {
        candidates: [candidate],
        job_attempts: [preparedJob(state, "job-discovery-direct-01", { kind: "CANDIDATE", candidate_id: candidate.candidate_id })],
      },
    }),
    run_operation: async () => {
      throw new TypeError(primaryMessage)
    },
    release_lock: async () => ({
      kind: "error",
      error_code: "STORAGE_WRITE_FAILED",
      message: "Injected operation lock release failure",
    }),
  }).then(() => {
    throw new TypeError("Campaign operation unexpectedly completed")
  })
}

async function runOperationWithThrownCleanup(
  directory: string,
  operationError: Error,
  cleanupError: Error,
): Promise<never> {
  const state = emptyDiscoveryState()
  await startResearchCampaignState({ directory, state })
  const candidate = strategyCandidate(false)
  return stepResearchCampaign({
    directory,
    campaign_id: state.campaign_id,
    expected_state_revision: 0,
    mode: "one_stage",
  }, {
    plan_operation: () => ({
      ok: true,
      plan: {
        candidates: [candidate],
        job_attempts: [preparedJob(state, "job-discovery-direct-01", { kind: "CANDIDATE", candidate_id: candidate.candidate_id })],
      },
    }),
    run_operation: async () => {
      throw operationError
    },
    release_lock: async () => {
      throw cleanupError
    },
  }).then(() => {
    throw new TypeError("Campaign operation unexpectedly completed")
  })
}
