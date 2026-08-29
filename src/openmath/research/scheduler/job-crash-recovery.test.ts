import { describe, expect, test } from "bun:test"

import {
  CampaignHashSchema,
  CampaignJobAttemptSchema,
  CampaignJobReceiptSchema,
  CampaignJobTargetSchema,
  type CampaignJobAttempt,
} from "../state"
import { compareAndSwapResearchCampaignState, startResearchCampaignState } from "../storage"
import { reduceCampaignTransition } from "../transitions"
import { preparedJob } from "../transitions/operation-test-fixture"
import { emptyDiscoveryState } from "../transitions/transition-test-fixture"
import { changed, strategyCandidate } from "../transitions/transition-test-fixture"
import {
  removeTemporaryCampaignDirectory,
  temporaryCampaignDirectory,
} from "../application/application-test-fixture"
import {
  createCampaignJobCrashRuntime,
  type CampaignJobCrashBoundary,
} from "./job-crash-test-runtime"
import { prepareCampaignJobAttempt } from "./prepare-campaign-job-attempt"
import { progressCampaignJobAttempt } from "./progress-campaign-job-attempt"
import { sha256 } from "../../workflow/stage-runner/sha256"

const HASH = CampaignHashSchema.parse("a".repeat(64))

describe("campaign job crash recovery", () => {
  test.each([
    "CHILD_CREATED",
    "SESSION_CREATED",
    "PROMPT_APPENDED",
    "PROMPT_SENT",
    "OUTPUT_FETCHED",
    "COMPLETED",
  ] as const)("resumes after %s with one child, prompt, output receipt, and completion", async (boundary: CampaignJobCrashBoundary) => {
    // given
    const directory = temporaryCampaignDirectory()
    const prepared = await persistRunningCampaign(directory)
    const harness = createCampaignJobCrashRuntime({
      directory,
      campaign_id: "campaign-1",
      initial_attempt: prepared,
      boundary,
    })

    // when
    try {
      await expect(progress(await harness.current_attempt(), harness.runtime)).rejects.toThrow(`crash after ${boundary}`)
      const resumed = await progress(await harness.current_attempt(), harness.runtime)

      // then
      expect(resumed).toMatchObject({ kind: "completed", attempt: { phase: "COMPLETED" } })
      if (resumed.kind === "completed") expect(resumed.attempt.raw_output_sha256).toBe(sha256("artifact output"))
      expect(harness.counts()).toEqual({ child_created: 1, prompt_sent: 1 })
      expect(harness.phase_history.filter((phase) => phase === "COMPLETED")).toHaveLength(1)
    } finally {
      removeTemporaryCampaignDirectory(directory)
    }
  })

  test("does not dispatch a committed attempt again", async () => {
    // given
    let dispatches = 0
    const committed = CampaignJobAttemptSchema.parse({
      ...preparedAttempt(),
      phase: "COMMITTED",
      phase_revision: 5,
      child_session_id: "ses_child1",
      raw_output_sha256: HASH,
      receipt: CampaignJobReceiptSchema.parse({ kind: "CANDIDATE_ARTIFACT", candidate_id: "direct-01", artifact_sha256: HASH }),
    })
    const harness = createCampaignJobCrashRuntime({
      directory: "/unused",
      campaign_id: "campaign-1",
      initial_attempt: committed,
      boundary: "COMPLETED",
    })
    const runtime = {
      ...harness.runtime,
      dispatch: async (input: Parameters<typeof harness.runtime.dispatch>[0]) => {
        dispatches += 1
        return harness.runtime.dispatch(input)
      },
    }

    // when
    const result = await progress(committed, runtime)

    // then
    expect(result).toMatchObject({ kind: "committed", attempt: committed })
    expect(dispatches).toBe(0)
  })

  test("reports a terminal error receipt as failed without redispatching the completed attempt", async () => {
    // given
    let dispatches = 0
    const failed = CampaignJobAttemptSchema.parse({
      ...preparedAttempt(),
      phase: "COMPLETED",
      phase_revision: 4,
      child_session_id: "ses_failed1",
      raw_output_sha256: HASH,
      receipt: CampaignJobReceiptSchema.parse({ kind: "ERROR", error_code: "SUBAGENT_FAILED", message: "transport failed" }),
    })
    const harness = createCampaignJobCrashRuntime({
      directory: "/unused",
      campaign_id: "campaign-1",
      initial_attempt: failed,
      boundary: "COMPLETED",
    })
    const runtime = {
      ...harness.runtime,
      dispatch: async (input: Parameters<typeof harness.runtime.dispatch>[0]) => {
        dispatches += 1
        return harness.runtime.dispatch(input)
      },
    }

    // when
    const result = await progress(failed, runtime)

    // then
    expect(result).toMatchObject({ kind: "failed", attempt: failed })
    expect(dispatches).toBe(0)
  })
})

function preparedAttempt() {
  return prepareCampaignJobAttempt({
    state: emptyDiscoveryState(),
    job_id: "job-discovery-direct-01",
    target: CampaignJobTargetSchema.parse({ kind: "CANDIDATE", candidate_id: "direct-01" }),
    role: "candidate-generator",
    resolved_model: { providerID: "openai", modelID: "gpt-5" },
    profile_sha256: HASH,
    prompt_sha256: HASH,
    reference_sha256: HASH,
    input_sha256: HASH,
  })
}

async function persistRunningCampaign(directory: string): Promise<CampaignJobAttempt> {
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
  const attempt = persisted.state.job_attempts[0]
  if (attempt === undefined) throw new TypeError("Expected prepared campaign job")
  return attempt
}

function progress(attempt: CampaignJobAttempt, runtime: Parameters<typeof progressCampaignJobAttempt>[0]["runtime"]) {
  return progressCampaignJobAttempt({
    parent_session_id: "ses_parent1",
    attempt,
    system_content: undefined,
    user_prompt: "payload",
    receipt_from_output: () => CampaignJobReceiptSchema.parse({ kind: "CANDIDATE_ARTIFACT", candidate_id: "direct-01", artifact_sha256: HASH }),
    runtime,
  })
}
