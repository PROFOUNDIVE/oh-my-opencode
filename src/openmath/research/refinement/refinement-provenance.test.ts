import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import { stepResearchCampaign } from "../application"
import { removeTemporaryCampaignDirectory, temporaryCampaignDirectory } from "../application/application-test-fixture"
import { ResearchCampaignStateV1Schema } from "../state"
import { readResearchCampaignState } from "../storage"
import { createSelectedRefinementStepDependencies } from "./refinement-operations"
import { createKeepSelection, createMergeSelection, FakeRefinementTransport, reviewOutput } from "./refinement-test-support"

describe("committed refinement provenance", () => {
  let directory: string

  beforeEach(() => {
    directory = temporaryCampaignDirectory()
  })

  afterEach(() => {
    removeTemporaryCampaignDirectory(directory)
  })

  test("rejects a forged committed predecessor receipt", async () => {
    // given
    const selected = await createKeepSelection(directory)
    const transport = new FakeRefinementTransport([reviewOutput("[CORRECT]")])
    const refined = await stepResearchCampaign({
      directory, campaign_id: "campaign-a", expected_state_revision: selected.state_revision, mode: "one_stage",
    }, createSelectedRefinementStepDependencies({ directory, create_job_runtime: (callbacks) => transport.runtime(callbacks) }))
    if (!refined.ok) throw new Error(refined.message)
    const stored = await readResearchCampaignState(directory, "campaign-a")
    if (stored.kind !== "ok") throw new Error(stored.message)
    const refinement = stored.state.job_attempts.find((job) => (
      job.phase === "COMMITTED" && job.receipt.kind === "CANDIDATE_ARTIFACT"
      && job.receipt.predecessor_artifact !== undefined
    ))
    if (refinement?.phase !== "COMMITTED" || refinement.receipt.kind !== "CANDIDATE_ARTIFACT"
      || refinement.receipt.predecessor_artifact === undefined) throw new TypeError("Refinement receipt is unavailable")
    const receipt = refinement.receipt
    const predecessor = receipt.predecessor_artifact
    if (predecessor === undefined) throw new TypeError("Refinement predecessor is unavailable")

    // when
    const forged = ResearchCampaignStateV1Schema.safeParse({
      ...stored.state,
      job_attempts: stored.state.job_attempts.map((job) => job.job_id === refinement.job_id ? {
        ...job,
        receipt: {
          ...receipt,
          predecessor_artifact: {
            ...predecessor,
            child_state_revision: predecessor.child_state_revision + 100,
          },
        },
      } : job),
    })

    // then
    expect(forged.success).toBe(false)
  })

  test.each(["predecessor_artifact", "refined_artifact"] as const)(
    "rejects a committed refinement receipt without %s",
    async (field: "predecessor_artifact" | "refined_artifact") => {
      // given
      const selected = await createKeepSelection(directory)
      const transport = new FakeRefinementTransport([reviewOutput("[CORRECT]")])
      await stepResearchCampaign({
        directory, campaign_id: "campaign-a", expected_state_revision: selected.state_revision, mode: "one_stage",
      }, createSelectedRefinementStepDependencies({ directory, create_job_runtime: (callbacks) => transport.runtime(callbacks) }))
      const stored = await readResearchCampaignState(directory, "campaign-a")
      if (stored.kind !== "ok") throw new Error(stored.message)
      const refinement = stored.state.job_attempts.find((job) => (
        job.phase === "COMMITTED" && job.receipt.kind === "CANDIDATE_ARTIFACT"
        && job.receipt.refined_artifact !== undefined
      ))
      if (refinement?.phase !== "COMMITTED" || refinement.receipt.kind !== "CANDIDATE_ARTIFACT") {
        throw new TypeError("Refinement receipt is unavailable")
      }

      // when
      const incomplete = ResearchCampaignStateV1Schema.safeParse({
        ...stored.state,
        job_attempts: stored.state.job_attempts.map((job) => job.job_id === refinement.job_id ? {
          ...job,
          receipt: { ...refinement.receipt, [field]: undefined },
        } : job),
      })

      // then
      expect(incomplete.success).toBe(false)
    },
  )

  test("rejects a selected merge refinement without its refined artifact edge", async () => {
    // given
    const selected = await createMergeSelection(directory)
    const transport = new FakeRefinementTransport(["# merged proof", reviewOutput("[CORRECT]")])
    const refined = await stepResearchCampaign({
      directory, campaign_id: "campaign-a", expected_state_revision: selected.state_revision, mode: "one_stage",
    }, createSelectedRefinementStepDependencies({ directory, create_job_runtime: (callbacks) => transport.runtime(callbacks) }))
    if (!refined.ok) throw new Error(refined.message)
    const stored = await readResearchCampaignState(directory, "campaign-a")
    if (stored.kind !== "ok") throw new Error(stored.message)
    const refinement = stored.state.job_attempts.find((job) => (
      job.phase === "COMMITTED" && job.target.kind === "CANDIDATE" && job.target.candidate_id === "merged-01"
    ))
    if (refinement?.phase !== "COMMITTED" || refinement.receipt.kind !== "CANDIDATE_ARTIFACT") {
      throw new TypeError("Merge refinement receipt is unavailable")
    }

    // when
    const incomplete = ResearchCampaignStateV1Schema.safeParse({
      ...stored.state,
      job_attempts: stored.state.job_attempts.map((job) => job.job_id === refinement.job_id ? {
        ...job,
        receipt: { ...refinement.receipt, refined_artifact: undefined },
      } : job),
    })

    // then
    expect(incomplete.success).toBe(false)
  })
})
