import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import { buildCampaignSourceSnapshot } from "../application/build-campaign-source-snapshot"
import { createInitialCampaignState } from "../application/create-initial-campaign-state"
import {
  objectiveSnapshot,
  profileSnapshot,
  referenceSnapshot,
  removeTemporaryCampaignDirectory,
  temporaryCampaignDirectory,
} from "../application/application-test-fixture"
import { stepResearchCampaign } from "../application"
import type { CampaignJobRuntime } from "../scheduler"
import { readResearchCampaignState, startResearchCampaignState } from "../storage"
import { createCandidateDiscoveryStepDependencies } from "./candidate-discovery-operations"
import { FakeCandidateTransport } from "./candidate-discovery-test-runtime"

describe("candidate discovery recovery", () => {
  let directory: string

  beforeEach(() => {
    directory = temporaryCampaignDirectory()
  })

  afterEach(() => {
    removeTemporaryCampaignDirectory(directory)
  })

  test("resumes a solved child after campaign completion persistence fails without redispatch", async () => {
    // given
    const profile = profileSnapshot()
    const initial = createInitialCampaignState({
      campaign_id: "campaign-a",
      parent_session_id: "ses_parent",
      source_snapshot: buildCampaignSourceSnapshot({
        objective: objectiveSnapshot(),
        profile,
        references: referenceSnapshot(),
      }),
    })
    const transport = new FakeCandidateTransport()
    let failCompletion = true
    await startResearchCampaignState({ directory, state: initial })
    const failingRuntime = (callbacks: Pick<CampaignJobRuntime, "persist_job_attempt" | "block_reconciliation">): CampaignJobRuntime => {
      const runtime = transport.runtime(callbacks)
      return {
        ...runtime,
        persist_job_attempt: async (update) => {
          if (failCompletion && update.phase === "COMPLETED") {
            failCompletion = false
            return { ok: false, error_code: "STORAGE_WRITE_FAILED", message: "injected completion failure" }
          }
          return callbacks.persist_job_attempt(update)
        },
      }
    }

    // when
    const interrupted = await stepResearchCampaign({
      directory,
      campaign_id: initial.campaign_id,
      expected_state_revision: 0,
      mode: "one_stage",
    }, createCandidateDiscoveryStepDependencies({ directory, create_job_runtime: failingRuntime }))
    const persisted = await readResearchCampaignState(directory, initial.campaign_id)
    if (persisted.kind === "error") throw new TypeError(persisted.message)
    const dispatchesBeforeResume = transport.requests.length
    const resumed = await stepResearchCampaign({
      directory,
      campaign_id: initial.campaign_id,
      expected_state_revision: persisted.state.state_revision,
      mode: "one_stage",
    }, createCandidateDiscoveryStepDependencies({
      directory,
      create_job_runtime: (callbacks) => transport.runtime(callbacks),
    }))

    // then
    expect(interrupted).toMatchObject({ ok: false, error_code: "STORAGE_WRITE_FAILED" })
    expect(resumed).toMatchObject({ ok: true, phase: "SCREENING", status: "READY" })
    expect(transport.requests).toHaveLength(dispatchesBeforeResume)
  })

  test("reuses the workflow session when campaign SESSION_CREATED persistence fails", async () => {
    // given
    const profile = profileSnapshot()
    const initial = createInitialCampaignState({
      campaign_id: "campaign-a",
      parent_session_id: "ses_parent",
      source_snapshot: buildCampaignSourceSnapshot({ objective: objectiveSnapshot(), profile, references: referenceSnapshot() }),
    })
    const transport = new FakeCandidateTransport()
    let failSessionReceipt = true
    await startResearchCampaignState({ directory, state: initial })
    const failingRuntime = (callbacks: Pick<CampaignJobRuntime, "persist_job_attempt" | "block_reconciliation">): CampaignJobRuntime => {
      const runtime = transport.runtime(callbacks)
      return {
        ...runtime,
        persist_job_attempt: async (update) => {
          if (failSessionReceipt && update.phase === "SESSION_CREATED") {
            failSessionReceipt = false
            return { ok: false, error_code: "STORAGE_WRITE_FAILED", message: "injected session receipt failure" }
          }
          return callbacks.persist_job_attempt(update)
        },
      }
    }

    // when
    const interrupted = await stepResearchCampaign({
      directory,
      campaign_id: initial.campaign_id,
      expected_state_revision: 0,
      mode: "one_stage",
    }, createCandidateDiscoveryStepDependencies({ directory, create_job_runtime: failingRuntime }))
    const blocked = await readResearchCampaignState(directory, initial.campaign_id)
    if (blocked.kind === "error") throw new TypeError(blocked.message)
    const resumed = await stepResearchCampaign({
      directory,
      campaign_id: initial.campaign_id,
      expected_state_revision: blocked.state.state_revision,
      mode: "one_stage",
    }, createCandidateDiscoveryStepDependencies({
      directory,
      create_job_runtime: (callbacks) => transport.runtime(callbacks),
    }))

    // then
    expect(interrupted).toMatchObject({ ok: false, error_code: "STORAGE_WRITE_FAILED" })
    expect(resumed).toMatchObject({ ok: true, phase: "SCREENING", status: "READY" })
    expect(new Set(transport.createdSessionIds).size).toBe(2)
    expect(transport.requests.some((request) => request.persisted_session_id !== undefined)).toBe(true)
  })
})
