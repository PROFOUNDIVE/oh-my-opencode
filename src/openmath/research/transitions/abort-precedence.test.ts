import { describe, expect, test } from "bun:test"

import { reduceCampaignTransition } from "./index"
import {
  HASH_B,
  completedJob,
  preparedJob,
} from "./operation-test-fixture"
import {
  changed,
  firstCandidate,
  selectedCandidateId,
  stateFor,
} from "./transition-test-fixture"
import { CandidateDescriptorSchema } from "../state"

describe("cooperative campaign abort", () => {
  test("aborts immediately outside RUNNING", () => {
    // given
    const states = [
      stateFor("DISCOVERY", "READY"),
      stateFor("SCREENING", "BLOCKED"),
    ]

    // when
    const results = states.map((state) => reduceCampaignTransition(state, {
      type: "ABORT",
      reason: "operator stopped the campaign",
    }))

    // then
    expect(results.every((result) => result.ok && result.state.status === "ABORTED")).toBe(true)
  })

  test("RUNNING abort retains completed audit evidence and discards child mutation", () => {
    // given
    const ready = stateFor("DEEP_REFINEMENT", "READY")
    const selectedId = selectedCandidateId(ready)
    const prepared = preparedJob(ready, "job-refinement-abort", {
      kind: "CANDIDATE",
      candidate_id: selectedId,
    })
    const running = changed(reduceCampaignTransition(ready, {
      type: "ADMIT_OPERATION",
      job_attempts: [prepared],
      candidates: [],
    }))
    const abortRequested = changed(reduceCampaignTransition(running, {
      type: "ABORT",
      reason: "stop after the child returns",
    }))
    const completed = completedJob(prepared, 13, {
      kind: "CANDIDATE_ARTIFACT",
      candidate_id: selectedId,
      artifact_sha256: HASH_B,
    })
    const laterCandidate = CandidateDescriptorSchema.parse({
      ...firstCandidate(ready),
      child_state_revision: 99,
      artifact: {
        child_run_id: "campaign-1::direct-01",
        child_state_revision: 99,
        artifact_version: 99,
        media_type: "text/markdown",
        sha256: HASH_B,
      },
    })

    // when
    const result = reduceCampaignTransition(abortRequested, {
      type: "COMPLETE_CHILD_WORKFLOW",
      job_attempts: [completed],
      child_result: { status: "PASSED", candidate: laterCandidate },
    })

    // then
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.state.status).toBe("ABORTED")
      expect(result.state.candidates).toEqual(ready.candidates)
      expect(result.state.dossier).toBeNull()
      expect(result.state.job_attempts.find((job) => job.job_id === completed.job_id)?.phase).toBe("COMPLETED")
      expect(result.state.abort_reason).toBe("stop after the child returns")
    }
  })

  test.each(["BLOCK", "REJECT"] as const)(
    "RUNNING abort overrides later %s outcome",
    (type: "BLOCK" | "REJECT") => {
    // given
    const ready = stateFor("DISCOVERY", "READY")
    const candidate = firstCandidate(ready)
    const prepared = preparedJob(ready, `job-abort-${type.toLowerCase()}`, {
      kind: "CANDIDATE",
      candidate_id: candidate.candidate_id,
    })
    const running = changed(reduceCampaignTransition(ready, {
      type: "ADMIT_OPERATION",
      job_attempts: [prepared],
      candidates: [],
    }))
    const abortRequested = changed(reduceCampaignTransition(running, { type: "ABORT", reason: "stop" }))
    const completed = completedJob(prepared, 13, {
      kind: "CANDIDATE_ARTIFACT",
      candidate_id: candidate.candidate_id,
      artifact_sha256: candidate.artifact?.sha256 ?? HASH_B,
    })

    // when
    const result = type === "BLOCK"
      ? reduceCampaignTransition(abortRequested, { type, reason: "late block", job_attempts: [completed] })
      : reduceCampaignTransition(abortRequested, { type, job_attempts: [completed] })

    // then
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.state.status).toBe("ABORTED")
    },
  )
})
