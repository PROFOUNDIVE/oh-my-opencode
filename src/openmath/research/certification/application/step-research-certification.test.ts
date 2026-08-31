import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import { ResearchCampaignStateV1Schema } from "../../state"
import {
  removeTemporaryCampaignDirectory,
  temporaryCampaignDirectory,
} from "../../application/application-test-fixture"
import { prepareCertificationJobAttempt } from "../scheduler"
import { readCertificationGeneration } from "../storage"
import { applicationStorageWithoutCampaignGuard, certifiedPromotionFixture } from "./certification-application-test-fixture"
import { initializeResearchCertification } from "./initialize-research-certification"
import { stepResearchCertification } from "./step-research-certification"

describe("certification step orchestration", () => {
  let directory: string

  beforeEach(() => {
    directory = temporaryCampaignDirectory()
  })

  afterEach(() => {
    removeTemporaryCampaignDirectory(directory)
  })

  test("persists PREPARED before invoking scheduler side effects", async () => {
    // given
    const fixture = certifiedPromotionFixture()
    const initialized = await initialize(fixture, directory)
    let observedRevision = -1

    // when
    const result = await stepResearchCertification({
      directory,
      campaign_id: fixture.campaign.campaign_id,
      expected_state_revision: fixture.campaign.state_revision,
      expected_certification_revision: 0,
      mode: "one_stage",
    }, {
      ...readers(fixture),
      plan_operation: (state) => ({
        ok: true,
        job_attempts: [extractionJob(state)],
        consume_amendment_ids: [],
      }),
      run_operation: async ({ state }) => {
        const stored = await readCertificationGeneration({
          directory,
          campaign_id: fixture.campaign.campaign_id,
          selected_artifact: initialized.selected_artifact,
          certification_profile_sha256: initialized.certification_profile_sha256,
          initialized_from_campaign_revision: fixture.campaign.state_revision,
        })
        observedRevision = stored.kind === "ok" ? stored.state.certification_revision : -1
        expect(state).toMatchObject({ status: "RUNNING", job_attempts: [{ phase: "PREPARED" }] })
        return { ok: true }
      },
    })

    // then
    expect(observedRevision).toBe(1)
    expect(result).toMatchObject({ kind: "ok", state: { status: "RUNNING", certification_revision: 1 } })
  })

  test("serializes concurrent lifecycle callbacks through certification CAS", async () => {
    // given
    const fixture = certifiedPromotionFixture()
    await initialize(fixture, directory)

    // when
    const result = await stepResearchCertification({
      directory,
      campaign_id: fixture.campaign.campaign_id,
      expected_state_revision: fixture.campaign.state_revision,
      expected_certification_revision: 0,
      mode: "one_stage",
    }, {
      ...readers(fixture),
      plan_operation: (state) => ({ ok: true, job_attempts: [extractionJob(state)], consume_amendment_ids: [] }),
      run_operation: async ({ state, persist_job_attempt }) => {
        const job = state.job_attempts[0]
        if (job === undefined) throw new TypeError("Expected prepared job")
        await Promise.all([
          persist_job_attempt({ phase: "SESSION_CREATED", job_id: job.job_id, child_session_id: "ses_cert1" }),
          persist_job_attempt({ phase: "PROMPT_SENT", job_id: job.job_id, child_session_id: "ses_cert1" }),
        ])
        return { ok: true }
      },
    })

    // then
    expect(result).toMatchObject({ kind: "ok", state: { certification_revision: 3, job_attempts: [{ phase: "PROMPT_SENT" }] } })
  })

  test("rereads campaign state and discards a result after campaign abort", async () => {
    // given
    const fixture = certifiedPromotionFixture()
    await initialize(fixture, directory)
    const aborted = ResearchCampaignStateV1Schema.parse({
      ...fixture.campaign,
      state_revision: fixture.campaign.state_revision + 1,
      status: "ABORTED",
      abort_requested: true,
      abort_reason: "stop",
    })
    let campaignReads = 0

    // when
    const result = await stepResearchCertification({
      directory,
      campaign_id: fixture.campaign.campaign_id,
      expected_state_revision: fixture.campaign.state_revision,
      expected_certification_revision: 0,
      mode: "one_stage",
    }, {
      ...readers(fixture),
      read_campaign: async () => {
        campaignReads += 1
        return { kind: "ok", state: campaignReads >= 3 ? aborted : fixture.campaign }
      },
      plan_operation: (state) => ({ ok: true, job_attempts: [extractionJob(state)], consume_amendment_ids: [] }),
      run_operation: async ({ commit_transition }) => {
        await commit_transition({ type: "BLOCK", reason: "DISPATCH_FAILED" })
        return { ok: true }
      },
    })

    // then
    expect(result).toMatchObject({ kind: "error", error_code: "CAMPAIGN_ABORTED" })
  })

  test("discards lifecycle callbacks after campaign abort", async () => {
    // given
    const fixture = certifiedPromotionFixture()
    await initialize(fixture, directory)
    const aborted = ResearchCampaignStateV1Schema.parse({
      ...fixture.campaign,
      state_revision: fixture.campaign.state_revision + 1,
      status: "ABORTED",
      abort_requested: true,
      abort_reason: "stop",
    })
    let campaignReads = 0
    let lifecycleWrites = 0

    // when
    const result = await stepResearchCertification({
      directory,
      campaign_id: fixture.campaign.campaign_id,
      expected_state_revision: fixture.campaign.state_revision,
      expected_certification_revision: 0,
      mode: "one_stage",
    }, {
      ...readers(fixture),
      read_campaign: async () => {
        campaignReads += 1
        return { kind: "ok", state: campaignReads >= 3 ? aborted : fixture.campaign }
      },
      plan_operation: (state) => ({ ok: true, job_attempts: [extractionJob(state)], consume_amendment_ids: [] }),
      persist_job_lifecycle: async () => {
        lifecycleWrites += 1
        return { ok: false, error_code: "STORAGE_WRITE_FAILED", message: "must not persist" }
      },
      run_operation: async ({ state, persist_job_attempt }) => {
        const job = state.job_attempts[0]
        if (job === undefined) throw new TypeError("Expected prepared job")
        await persist_job_attempt({ phase: "SESSION_CREATED", job_id: job.job_id, child_session_id: "ses_cert1" })
        return { ok: true }
      },
    })

    // then
    expect(result).toMatchObject({ kind: "error", error_code: "CAMPAIGN_ABORTED" })
    expect(lifecycleWrites).toBe(0)
  })

})

function extractionJob(state: Parameters<typeof prepareCertificationJobAttempt>[0]["state"]) {
  return prepareCertificationJobAttempt({
    state,
    job_id: "cert-job-extraction-0001",
    target: { kind: "EXTRACTION", coverage_round: 1, artifact_sha256: state.selected_artifact.artifact_sha256 },
    role: "extractor",
    resolved_model: { providerID: "openai", modelID: "gpt-5" },
    prompt_sha256: "a".repeat(64),
    input_sha256: "b".repeat(64),
  })
}

async function initialize(fixture: ReturnType<typeof certifiedPromotionFixture>, directory: string) {
  const result = await initializeResearchCertification({
    directory,
    campaign_id: fixture.campaign.campaign_id,
    expected_state_revision: fixture.campaign.state_revision,
  }, readers(fixture))
  if (result.kind !== "ok") throw new TypeError(result.message)
  return result.state
}

function readers(fixture: ReturnType<typeof certifiedPromotionFixture>) {
  return {
    ...applicationStorageWithoutCampaignGuard,
    read_campaign: async () => ({ kind: "ok" as const, state: fixture.campaign }),
    read_child: async () => ({ kind: "ok" as const, state: fixture.child }),
  }
}
