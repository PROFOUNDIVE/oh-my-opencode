import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import { amendResearchCampaign, stepResearchCampaign } from "../application"
import {
  removeTemporaryCampaignDirectory,
  temporaryCampaignDirectory,
} from "../application/application-test-fixture"
import { getWorkflowStatus } from "../../workflow/application/get-workflow-status"
import { abortWorkflow } from "../../workflow/application/abort-workflow"
import { sha256 } from "../../workflow/stage-runner/sha256"
import { TournamentResultSchema } from "../state"
import { createTournamentStepDependencies } from "./tournament-operations"
import { startMergeCandidate } from "./start-merge-candidate"
import {
  campaignState,
  createScreenedCampaign,
  FakeTournamentTransport,
  keepOutput,
} from "./tournament-operation.test-support"

describe("tournament human and merge outcomes", () => {
  let directory: string

  beforeEach(() => {
    directory = temporaryCampaignDirectory()
  })

  afterEach(() => {
    removeTemporaryCampaignDirectory(directory)
  })

  test("NEEDS_HUMAN requires an applicable amendment before retry", async () => {
    // given
    const checkpoint = await createScreenedCampaign(directory)
    const transport = new FakeTournamentTransport(directory, [
      JSON.stringify({ kind: "NEEDS_HUMAN" }),
      keepOutput(),
    ])
    const dependencies = createTournamentStepDependencies({
      directory,
      create_job_runtime: (callbacks) => transport.runtime(callbacks),
    })
    const paused = await stepResearchCampaign({
      directory, campaign_id: "campaign-a", expected_state_revision: checkpoint.state_revision, mode: "one_stage",
    }, dependencies)
    if (!paused.ok) throw new Error(paused.message)

    // when
    const denied = await stepResearchCampaign({
      directory, campaign_id: "campaign-a", expected_state_revision: paused.state_revision, mode: "one_stage",
    }, dependencies)
    const amended = await amendResearchCampaign({
      directory,
      campaign_id: "campaign-a",
      expected_state_revision: paused.state_revision,
      operation: "add",
      kind: "required_check",
      scope: "next_tournament",
      content: "Resolve the ambiguity before retry.",
    })
    if (!amended.ok) throw new Error(amended.message)
    const retried = await stepResearchCampaign({
      directory, campaign_id: "campaign-a", expected_state_revision: amended.state_revision, mode: "one_stage",
    }, dependencies)

    // then
    expect(denied).toMatchObject({ ok: false, error_code: "ILLEGAL_TRANSITION" })
    expect(retried).toMatchObject({ ok: true, selected_candidate_id: "direct-01" })
    const amendments = (await campaignState(directory)).amendments
    expect(amendments[amendments.length - 1]).toMatchObject({ event_type: "CONSUMED" })
  })

  test("MERGE_IDEA starts one fresh lineage child without parent artifact bytes", async () => {
    // given
    const checkpoint = await createScreenedCampaign(directory)
    const parentsBefore = await Promise.all(checkpoint.candidates.map((candidate) => (
      getWorkflowStatus({ directory, run_id: candidate.child_run_id })
    )))
    const brief = "Use the direct reduction inside the contradiction framework."
    const output = JSON.stringify({
      kind: "DECIDED",
      actions: [
        { label: "entry-001", action: "MERGE_IDEA" },
        { label: "entry-002", action: "MERGE_IDEA" },
      ],
      synthesis_brief: brief,
    })
    const transport = new FakeTournamentTransport(directory, [output])

    // when
    const result = await stepResearchCampaign({
      directory, campaign_id: "campaign-a", expected_state_revision: checkpoint.state_revision, mode: "one_stage",
    }, createTournamentStepDependencies({
      directory,
      create_job_runtime: (callbacks) => transport.runtime(callbacks),
    }))

    // then
    expect(result).toMatchObject({ ok: true, phase: "DEEP_REFINEMENT", status: "READY" })
    const stored = await campaignState(directory)
    const merge = stored.candidates.find((candidate) => candidate.candidate_kind === "MERGE_IDEA")
    expect(merge).toMatchObject({
      candidate_id: "merged-01",
      parent_candidate_ids: ["direct-01", "contradiction-01"],
      synthesis_brief: brief,
      artifact: null,
    })
    if (merge === undefined) throw new Error("Expected merge candidate")
    const child = await getWorkflowStatus({ directory, run_id: merge.child_run_id })
    expect(child.kind).toBe("ok")
    if (child.kind !== "ok") throw new Error(child.message)
    expect(child.state.request_snapshot).toEqual(checkpoint.source_snapshot.objective.request)
    expect(child.state.amendments).toHaveLength(1)
    expect(child.state.amendments[0]).toMatchObject({ content: brief, scope: "all_remaining" })
    expect(child.state.artifact).toBeNull()
    const childBytes = JSON.stringify(child.state)
    for (const parent of parentsBefore) {
      if (parent.kind === "ok" && parent.state.artifact !== null) expect(childBytes).not.toContain(parent.state.artifact.content)
    }
  })

  test("MERGE_IDEA rejects an aborted deterministic child instead of adopting stale state", async () => {
    // given
    const checkpoint = await createScreenedCampaign(directory)
    const brief = "Use the direct reduction inside the contradiction framework."
    const tournamentResult = TournamentResultSchema.parse({
      kind: "DECIDED",
      actions: [
        { candidate_id: "direct-01", action: "MERGE_IDEA" },
        { candidate_id: "contradiction-01", action: "MERGE_IDEA" },
      ],
      synthesis_brief: brief,
      synthesis_brief_sha256: sha256(brief),
    })
    if (tournamentResult.kind !== "DECIDED") throw new TypeError("Expected decided tournament result")
    const seeded = await startMergeCandidate({
      directory,
      state: checkpoint,
      result: tournamentResult,
      created_at_revision: checkpoint.state_revision + 1,
    })
    if (!seeded.ok) throw new Error(seeded.message)
    const aborted = await abortWorkflow({
      directory,
      run_id: seeded.candidate.child_run_id,
      expected_state_revision: seeded.candidate.child_state_revision ?? 0,
      reason: "stale merge child fixture",
    })
    if (aborted.kind === "error") throw new Error(aborted.message)
    const transport = new FakeTournamentTransport(directory, [JSON.stringify({
      kind: "DECIDED",
      actions: [
        { label: "entry-001", action: "MERGE_IDEA" },
        { label: "entry-002", action: "MERGE_IDEA" },
      ],
      synthesis_brief: brief,
    })])

    // when
    const result = await stepResearchCampaign({
      directory,
      campaign_id: "campaign-a",
      expected_state_revision: checkpoint.state_revision,
      mode: "one_stage",
    }, createTournamentStepDependencies({
      directory,
      create_job_runtime: (callbacks) => transport.runtime(callbacks),
    }))

    // then
    expect(result).toMatchObject({ ok: false, error_code: "CHILD_WORKFLOW_FAILED" })
    expect(await campaignState(directory)).toMatchObject({ status: "BLOCKED" })
  })
})
