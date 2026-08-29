import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import { compareAndSwapWorkflowState } from "../../workflow/storage"
import { getWorkflowStatus } from "../../workflow/application/get-workflow-status"
import { stepResearchCampaign } from "../application"
import {
  removeTemporaryCampaignDirectory,
  temporaryCampaignDirectory,
} from "../application/application-test-fixture"
import { readResearchCampaignState } from "../storage"
import { createSelectedRefinementStepDependencies } from "./refinement-operations"
import { createKeepSelection, FakeRefinementTransport, reviewOutput } from "./refinement-test-support"

describe("selected candidate refinement failures", () => {
  let directory: string

  beforeEach(() => {
    directory = temporaryCampaignDirectory()
  })

  afterEach(() => {
    removeTemporaryCampaignDirectory(directory)
  })

  test("fails closed when the selected child revision drifted outside a forwarded amendment", async () => {
    // given
    const selected = await createKeepSelection(directory)
    const candidate = selected.candidates.find((current) => current.candidate_id === selected.selected_candidate_id)
    if (candidate?.child_state_revision === null || candidate === undefined) throw new TypeError("Selected child is unavailable")
    const child = await getWorkflowStatus({ directory, run_id: candidate.child_run_id })
    if (child.kind !== "ok") throw new Error(child.message)
    const drifted = await compareAndSwapWorkflowState({
      directory,
      run_id: candidate.child_run_id,
      expected_state_revision: child.state.state_revision,
      next_state: { ...child.state, state_revision: child.state.state_revision + 1 },
    })
    if (drifted.kind !== "ok") throw new Error(drifted.message)
    const transport = new FakeRefinementTransport([reviewOutput("[CORRECT]")])

    // when
    const result = await stepResearchCampaign({
      directory, campaign_id: "campaign-a", expected_state_revision: selected.state_revision, mode: "one_stage",
    }, createSelectedRefinementStepDependencies({
      directory,
      create_job_runtime: (callbacks) => transport.runtime(callbacks),
    }))

    // then
    expect(result).toMatchObject({ ok: false, error_code: "CHILD_WORKFLOW_FAILED" })
    expect(transport.requests).toHaveLength(0)
    expect(await storedStatus(directory)).toBe("BLOCKED")
  })

  test("rejects an accidental second selected-candidate job before dispatch", async () => {
    // given
    const selected = await createKeepSelection(directory)
    const transport = new FakeRefinementTransport([reviewOutput("[CORRECT]")])
    const dependencies = createSelectedRefinementStepDependencies({
      directory,
      create_job_runtime: (callbacks) => transport.runtime(callbacks),
    })
    const originalPlan = dependencies.plan_operation(selected)
    if (!originalPlan.ok) throw new Error(originalPlan.message)
    const duplicatePlan = {
      ok: true as const,
      plan: { ...originalPlan.plan, job_attempts: [...originalPlan.plan.job_attempts, ...originalPlan.plan.job_attempts] },
    }

    // when
    const result = await stepResearchCampaign({
      directory, campaign_id: "campaign-a", expected_state_revision: selected.state_revision, mode: "one_stage",
    }, { ...dependencies, plan_operation: () => duplicatePlan })

    // then
    expect(result).toMatchObject({ ok: false, error_code: "VALIDATION_ERROR" })
    expect(transport.requests).toHaveLength(0)
  })

  test("maps ambiguous child reconciliation to a durable campaign block without trying another candidate", async () => {
    // given
    const selected = await createKeepSelection(directory)
    const transport = new FakeRefinementTransport([reviewOutput("[CORRECT]")])

    // when
    const result = await stepResearchCampaign({
      directory, campaign_id: "campaign-a", expected_state_revision: selected.state_revision, mode: "one_stage",
    }, createSelectedRefinementStepDependencies({
      directory,
      create_job_runtime: (callbacks) => ({
        ...transport.runtime(callbacks),
        list_children: async () => [{ id: "ses_duplicate_a" }, { id: "ses_duplicate_b" }],
        get_session: async () => {
          const child = await getWorkflowStatus({ directory, run_id: "campaign-a::direct-01" })
          if (child.kind !== "ok") throw new Error(child.message)
          const title = preparedChildTitle(child.state.dispatch_attempts)
          if (title === undefined) throw new TypeError("Prepared child attempt is unavailable")
          return { title }
        },
      }),
    }))

    // then
    expect(result).toMatchObject({ ok: false, error_code: "CHILD_WORKFLOW_FAILED" })
    expect(await storedStatus(directory)).toBe("BLOCKED")
    expect(transport.requests).toHaveLength(0)
  })
})

async function storedStatus(directory: string): Promise<string> {
  const stored = await readResearchCampaignState(directory, "campaign-a")
  if (stored.kind !== "ok") throw new Error(stored.message)
  return stored.state.status
}

function preparedChildTitle(attempts: readonly Readonly<{ readonly phase: string; readonly child_title: string }>[]): string | undefined {
  for (let index = attempts.length - 1; index >= 0; index -= 1) {
    const attempt = attempts[index]
    if (attempt?.phase === "PREPARED") return attempt.child_title
  }
  return undefined
}
