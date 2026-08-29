import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import { amendResearchCampaign, stepResearchCampaign } from "../application"
import {
  removeTemporaryCampaignDirectory,
  temporaryCampaignDirectory,
} from "../application/application-test-fixture"
import { getWorkflowStatus } from "../../workflow/application/get-workflow-status"
import { ResearchCampaignStateV1Schema } from "../state"
import { readResearchCampaignState } from "../storage"
import { createSelectedRefinementStepDependencies } from "./refinement-operations"
import {
  createKeepSelection,
  createMergeSelection,
  FakeRefinementTransport,
  reviewOutput,
} from "./refinement-test-support"

describe("selected candidate deep refinement", () => {
  let directory: string

  beforeEach(() => {
    directory = temporaryCampaignDirectory()
  })

  afterEach(() => {
    removeTemporaryCampaignDirectory(directory)
  })

  test("KEEP resumes only the persisted selected child and permits dossier readiness only after PASSED", async () => {
    // given
    const selected = await createKeepSelection(directory)
    const transport = new FakeRefinementTransport([reviewOutput("[CORRECT]")])

    // when
    const result = await stepResearchCampaign({
      directory, campaign_id: "campaign-a", expected_state_revision: selected.state_revision, mode: "one_stage",
    }, createSelectedRefinementStepDependencies({
      directory,
      create_job_runtime: (callbacks) => transport.runtime(callbacks),
    }))

    // then
    expect(result).toMatchObject({ ok: true, phase: "PROMOTION", status: "READY", dossier: null })
    expect(transport.requests).toHaveLength(1)
    const child = await getWorkflowStatus({ directory, run_id: "campaign-a::direct-01" })
    expect(child).toMatchObject({ kind: "ok", state: { status: "PASSED" } })
    const untouched = await getWorkflowStatus({ directory, run_id: "campaign-a::contradiction-01" })
    expect(untouched).toMatchObject({ kind: "ok", state: { status: "AWAITING_HUMAN" } })
  })

  test("MERGE_IDEA reaches after-solve before continuing the same lineage child", async () => {
    // given
    const selected = await createMergeSelection(directory)
    const transport = new FakeRefinementTransport(["# merged proof", reviewOutput("[CORRECT]")])

    // when
    const result = await stepResearchCampaign({
      directory, campaign_id: "campaign-a", expected_state_revision: selected.state_revision, mode: "one_stage",
    }, createSelectedRefinementStepDependencies({
      directory,
      create_job_runtime: (callbacks) => transport.runtime(callbacks),
    }))

    // then
    expect(result).toMatchObject({ ok: true, phase: "PROMOTION", status: "READY", selected_candidate_id: "merged-01" })
    expect(transport.requests).toHaveLength(2)
    const child = await getWorkflowStatus({ directory, run_id: "campaign-a::merged-01" })
    expect(child).toMatchObject({ kind: "ok", state: { status: "PASSED" } })
  })

  test("selected-refinement amendment reaches the unchanged child amend service before resume", async () => {
    // given
    const selected = await createKeepSelection(directory)
    const pausedTransport = new FakeRefinementTransport([reviewOutput("[INCONCLUSIVE]")])
    const paused = await stepResearchCampaign({
      directory, campaign_id: "campaign-a", expected_state_revision: selected.state_revision, mode: "one_stage",
    }, createSelectedRefinementStepDependencies({
      directory,
      create_job_runtime: (callbacks) => pausedTransport.runtime(callbacks),
    }))
    if (!paused.ok) throw new Error(paused.message)

    // when
    const amended = await amendResearchCampaign({
      directory,
      campaign_id: "campaign-a",
      expected_state_revision: paused.state_revision,
      operation: "add",
      kind: "suspected_blocker",
      scope: "selected_refinement",
      content: "Resolve the remaining ambiguity.",
    })

    // then
    expect(paused).toMatchObject({ status: "AWAITING_HUMAN", awaiting_reason: "CHILD_WORKFLOW_INTERVENTION" })
    expect(amended).toMatchObject({ ok: true })
    const child = await getWorkflowStatus({ directory, run_id: "campaign-a::direct-01" })
    expect(child).toMatchObject({
      kind: "ok",
      state: { intervention_satisfied: true, amendments: expect.arrayContaining([
        expect.objectContaining({ scope: "all_remaining", content: "Resolve the remaining ambiguity." }),
      ]) },
    })
    if (!amended.ok) throw new Error(amended.message)
    const resumedTransport = new FakeRefinementTransport([reviewOutput("[CORRECT]")])
    const resumed = await stepResearchCampaign({
      directory, campaign_id: "campaign-a", expected_state_revision: amended.state_revision, mode: "one_stage",
    }, createSelectedRefinementStepDependencies({
      directory,
      create_job_runtime: (callbacks) => resumedTransport.runtime(callbacks),
    }))
    expect(resumed).toMatchObject({ ok: true, phase: "PROMOTION", status: "READY" })
    expect(pausedTransport.requests).toHaveLength(1)
    expect(resumedTransport.requests).toHaveLength(1)
    const untouched = await getWorkflowStatus({ directory, run_id: "campaign-a::contradiction-01" })
    expect(untouched).toMatchObject({ kind: "ok", state: { status: "AWAITING_HUMAN" } })
  })

  test("EXHAUSTED rejects the campaign without dispatching another candidate", async () => {
    // given
    const selected = await createKeepSelection(directory, 1)
    const transport = new FakeRefinementTransport([reviewOutput("[ERROR]")])

    // when
    const result = await stepResearchCampaign({
      directory, campaign_id: "campaign-a", expected_state_revision: selected.state_revision, mode: "one_stage",
    }, createSelectedRefinementStepDependencies({
      directory,
      create_job_runtime: (callbacks) => transport.runtime(callbacks),
    }))

    // then
    expect(result).toMatchObject({ ok: true, phase: "DEEP_REFINEMENT", status: "REJECTED", dossier: null })
    expect(transport.requests).toHaveLength(1)
    const child = await getWorkflowStatus({ directory, run_id: "campaign-a::direct-01" })
    expect(child).toMatchObject({ kind: "ok", state: { status: "EXHAUSTED" } })
    const untouched = await getWorkflowStatus({ directory, run_id: "campaign-a::contradiction-01" })
    expect(untouched).toMatchObject({ kind: "ok", state: { status: "AWAITING_HUMAN" } })
  })

  test("forwards two persisted refinement amendments in order before resuming", async () => {
    // given
    const selected = await createKeepSelection(directory)
    const pausedTransport = new FakeRefinementTransport([reviewOutput("[INCONCLUSIVE]")])
    const paused = await stepResearchCampaign({
      directory, campaign_id: "campaign-a", expected_state_revision: selected.state_revision, mode: "one_stage",
    }, createSelectedRefinementStepDependencies({ directory, create_job_runtime: (callbacks) => pausedTransport.runtime(callbacks) }))
    if (!paused.ok) throw new Error(paused.message)

    // when
    const first = await amendResearchCampaign({
      directory, campaign_id: "campaign-a", expected_state_revision: paused.state_revision,
      operation: "add", kind: "question", scope: "selected_refinement", content: "Check the first gap.",
    })
    if (!first.ok) throw new Error(first.message)
    const second = await amendResearchCampaign({
      directory, campaign_id: "campaign-a", expected_state_revision: first.state_revision,
      operation: "add", kind: "required_check", scope: "selected_refinement", content: "Check the second gap.",
    })

    // then
    expect(second).toMatchObject({ ok: true })
    const child = await getWorkflowStatus({ directory, run_id: "campaign-a::direct-01" })
    expect(child).toMatchObject({ kind: "ok", state: { amendments: expect.arrayContaining([
      expect.objectContaining({ scope: "all_remaining", content: "Check the first gap." }),
      expect.objectContaining({ scope: "all_remaining", content: "Check the second gap." }),
    ]) } })
  })

  test("rejects a forged screen predecessor after committed refinement", async () => {
    // given
    const selected = await createKeepSelection(directory)
    const transport = new FakeRefinementTransport([reviewOutput("[CORRECT]")])
    await stepResearchCampaign({
      directory, campaign_id: "campaign-a", expected_state_revision: selected.state_revision, mode: "one_stage",
    }, createSelectedRefinementStepDependencies({ directory, create_job_runtime: (callbacks) => transport.runtime(callbacks) }))
    const stored = await readResearchCampaignState(directory, "campaign-a")
    if (stored.kind !== "ok") throw new Error(stored.message)
    const firstScreen = stored.state.screen_receipts[0]
    if (firstScreen === undefined) throw new TypeError("Screen fixture is unavailable")

    // when
    const forged = ResearchCampaignStateV1Schema.safeParse({
      ...stored.state,
      screen_receipts: [{
        ...firstScreen,
        artifact: { ...firstScreen.artifact, child_state_revision: firstScreen.artifact.child_state_revision + 100 },
      }, ...stored.state.screen_receipts.slice(1)],
    })

    // then
    expect(forged.success).toBe(false)
  })
})
