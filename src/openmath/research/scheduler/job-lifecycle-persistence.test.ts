import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import { compareAndSwapResearchCampaignState, readResearchCampaignState, startResearchCampaignState } from "../storage"
import { CampaignJobReceiptSchema } from "../state"
import { reduceCampaignTransition } from "../transitions"
import { preparedJob } from "../transitions/operation-test-fixture"
import { changed, emptyDiscoveryState, strategyCandidate } from "../transitions/transition-test-fixture"
import {
  removeTemporaryCampaignDirectory,
  temporaryCampaignDirectory,
} from "../application/application-test-fixture"
import {
  blockCampaignJobReconciliation,
  commitCampaignJobLifecycle,
} from "../application/commit-campaign-job-lifecycle"
import { campaignJobForCommit } from "./campaign-job-for-commit"

describe("campaign job lifecycle persistence", () => {
  let directory: string

  beforeEach(() => {
    directory = temporaryCampaignDirectory()
  })

  afterEach(() => {
    removeTemporaryCampaignDirectory(directory)
  })

  test("persists every lifecycle receipt at its own exact campaign revision", async () => {
    // given
    const running = await persistRunningCampaign(directory)

    // when
    const session = await commitCampaignJobLifecycle({
      directory,
      campaign_id: running.campaign_id,
      update: { phase: "SESSION_CREATED", job_id: running.active_job_ids[0] ?? "", child_session_id: "ses_child1" },
    })
    const prompt = await commitCampaignJobLifecycle({
      directory,
      campaign_id: running.campaign_id,
      update: { phase: "PROMPT_SENT", job_id: running.active_job_ids[0] ?? "", child_session_id: "ses_child1" },
    })
    const completed = await commitCampaignJobLifecycle({
      directory,
      campaign_id: running.campaign_id,
      update: {
        phase: "COMPLETED",
        job_id: running.active_job_ids[0] ?? "",
        child_session_id: "ses_child1",
        raw_output_sha256: "b".repeat(64),
        receipt: CampaignJobReceiptSchema.parse({ kind: "CANDIDATE_ARTIFACT", candidate_id: "direct-01", artifact_sha256: "a".repeat(64) }),
      },
    })

    // then
    expect(session).toMatchObject({ ok: true, attempt: { phase: "SESSION_CREATED", phase_revision: 2 } })
    expect(prompt).toMatchObject({ ok: true, attempt: { phase: "PROMPT_SENT", phase_revision: 3 } })
    expect(completed).toMatchObject({ ok: true, attempt: { phase: "COMPLETED", phase_revision: 4 } })
    expect((await readResearchCampaignState(directory, running.campaign_id))).toMatchObject({
      kind: "ok",
      state: { state_revision: 4, job_attempts: [{ phase: "COMPLETED", raw_output_sha256: "b".repeat(64) }] },
    })
  })

  test("advances a persisted completion to one committed campaign receipt", async () => {
    // given
    const running = await persistRunningCampaign(directory)
    const jobId = running.active_job_ids[0] ?? ""
    await commitCampaignJobLifecycle({ directory, campaign_id: running.campaign_id, update: { phase: "SESSION_CREATED", job_id: jobId, child_session_id: "ses_child1" } })
    await commitCampaignJobLifecycle({ directory, campaign_id: running.campaign_id, update: { phase: "PROMPT_SENT", job_id: jobId, child_session_id: "ses_child1" } })
    const completed = await commitCampaignJobLifecycle({
      directory,
      campaign_id: running.campaign_id,
      update: {
        phase: "COMPLETED",
        job_id: jobId,
        child_session_id: "ses_child1",
        raw_output_sha256: "b".repeat(64),
        receipt: CampaignJobReceiptSchema.parse({ kind: "CANDIDATE_ARTIFACT", candidate_id: "direct-01", artifact_sha256: "a".repeat(64) }),
      },
    })
    if (!completed.ok || completed.state === undefined || completed.attempt.phase !== "COMPLETED") {
      throw new TypeError("Expected persisted completion evidence")
    }
    const candidate = strategyCandidate(true)

    // when
    const committed = reduceCampaignTransition(completed.state, {
      type: "COMPLETE_DISCOVERY",
      job_attempts: [campaignJobForCommit(completed.attempt, completed.state.state_revision)],
      candidates: [candidate],
    })

    // then
    expect(committed).toMatchObject({
      ok: true,
      state: { job_attempts: [{ phase: "COMMITTED", phase_revision: 5 }], active_job_ids: [] },
    })
  })

  test("rejects a stale lifecycle receipt without overwriting the durable phase", async () => {
    // given
    const running = await persistRunningCampaign(directory)
    const jobId = running.active_job_ids[0] ?? ""
    await commitCampaignJobLifecycle({
      directory,
      campaign_id: running.campaign_id,
      update: { phase: "SESSION_CREATED", job_id: jobId, child_session_id: "ses_child1" },
    })

    // when
    const stale = await commitCampaignJobLifecycle({
      directory,
      campaign_id: running.campaign_id,
      update: { phase: "SESSION_CREATED", job_id: jobId, child_session_id: "ses_other1" },
    })

    // then
    expect(stale).toMatchObject({ ok: false, error_code: "RECONCILIATION_BLOCKED" })
    expect((await readResearchCampaignState(directory, running.campaign_id))).toMatchObject({
      kind: "ok",
      state: { state_revision: 2, job_attempts: [{ phase: "SESSION_CREATED", child_session_id: "ses_child1" }] },
    })
  })

  test("rejects a stale output receipt without overwriting completion evidence", async () => {
    // given
    const running = await persistRunningCampaign(directory)
    const jobId = running.active_job_ids[0] ?? ""
    await commitCampaignJobLifecycle({ directory, campaign_id: running.campaign_id, update: { phase: "SESSION_CREATED", job_id: jobId, child_session_id: "ses_child1" } })
    await commitCampaignJobLifecycle({ directory, campaign_id: running.campaign_id, update: { phase: "PROMPT_SENT", job_id: jobId, child_session_id: "ses_child1" } })
    await commitCampaignJobLifecycle({
      directory,
      campaign_id: running.campaign_id,
      update: { phase: "COMPLETED", job_id: jobId, child_session_id: "ses_child1", raw_output_sha256: "b".repeat(64), receipt: CampaignJobReceiptSchema.parse({ kind: "CANDIDATE_ARTIFACT", candidate_id: "direct-01", artifact_sha256: "a".repeat(64) }) },
    })

    // when
    const stale = await commitCampaignJobLifecycle({
      directory,
      campaign_id: running.campaign_id,
      update: { phase: "COMPLETED", job_id: jobId, child_session_id: "ses_child1", raw_output_sha256: "c".repeat(64), receipt: CampaignJobReceiptSchema.parse({ kind: "CANDIDATE_ARTIFACT", candidate_id: "direct-01", artifact_sha256: "d".repeat(64) }) },
    })

    // then
    expect(stale).toMatchObject({ ok: false, error_code: "RECONCILIATION_BLOCKED" })
    expect(await readResearchCampaignState(directory, running.campaign_id)).toMatchObject({ kind: "ok", state: { job_attempts: [{ raw_output_sha256: "b".repeat(64) }] } })
  })

  test("persists an ambiguous reconciliation as campaign BLOCKED without choosing a child", async () => {
    // given
    const running = await persistRunningCampaign(directory)

    // when
    const result = await blockCampaignJobReconciliation({
      directory,
      campaign_id: running.campaign_id,
      job_id: running.active_job_ids[0] ?? "",
      message: "Multiple child sessions match the persisted campaign job key",
    })

    // then
    expect(result).toMatchObject({ ok: true, state: { status: "BLOCKED", state_revision: 2 } })
    expect((await readResearchCampaignState(directory, running.campaign_id))).toMatchObject({
      kind: "ok",
      state: { status: "BLOCKED", active_job_ids: [], job_attempts: [{ phase: "PREPARED" }] },
    })
  })
})

async function persistRunningCampaign(directory: string) {
  const initial = emptyDiscoveryState()
  await startResearchCampaignState({ directory, state: initial })
  const candidate = strategyCandidate(false)
  const running = changed(reduceCampaignTransition(initial, {
    type: "ADMIT_OPERATION",
    candidates: [candidate],
    job_attempts: [preparedJob(initial, "job-discovery-direct-01", { kind: "CANDIDATE", candidate_id: candidate.candidate_id })],
  }))
  const persisted = await compareAndSwapResearchCampaignState({
    directory,
    campaign_id: initial.campaign_id,
    expected_state_revision: 0,
    next_state: running,
  })
  if (persisted.kind === "error") throw new Error(persisted.message)
  return persisted.state
}
