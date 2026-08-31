import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import { removeTemporaryCampaignDirectory, temporaryCampaignDirectory } from "../../application/application-test-fixture"
import { completeCertificationState } from "../state/complete-state-test-fixture"
import { ResearchCertificationStateV1Schema, type ResearchCertificationStateV1 } from "../state/schema"
import { buildCertificationGenerationIndex } from "../storage/generation-index"
import { reduceCampaignTransition } from "../../transitions"
import { applicationStorageWithoutCampaignGuard, certifiedPromotionFixture } from "./certification-application-test-fixture"
import { initializeResearchCertification } from "./initialize-research-certification"
import { stepResearchCertification } from "./step-research-certification"

describe("completed certification publication", () => {
  let directory: string

  beforeEach(() => {
    directory = temporaryCampaignDirectory()
  })

  afterEach(() => {
    removeTemporaryCampaignDirectory(directory)
  })

  test("adopts a COMPLETE sidecar after campaign publication failure and then remains idempotent", async () => {
    // given
    const fixture = certifiedPromotionFixture()
    const initialized = await initializeResearchCertification({
      directory,
      campaign_id: fixture.campaign.campaign_id,
      expected_state_revision: fixture.campaign.state_revision,
    }, readers(fixture))
    if (initialized.kind !== "ok") throw new TypeError(initialized.message)
    const complete = completedState(initialized.state)
    const generation = generationRead(complete, fixture.campaign.state_revision)
    let campaign = fixture.campaign
    let campaignWrites = 0
    let failPublication = true
    const dependencies = {
      ...readers(fixture),
      read_campaign: async () => ({ kind: "ok" as const, state: campaign }),
      read_generation: async () => generation,
      read_attachment: async () => ({ kind: "ok" as const, state: complete, content_sha256: generation.content_sha256 }),
      compare_and_swap_campaign: async (request: { readonly next_state: typeof campaign }) => {
        if (failPublication) return { kind: "error" as const, error_code: "STORAGE_WRITE_FAILED" as const, message: "crash boundary" }
        campaignWrites += 1
        campaign = request.next_state
        return { kind: "ok" as const, state: campaign }
      },
      plan_operation: () => { throw new TypeError("completed sidecar must not schedule work") },
      run_operation: async () => { throw new TypeError("completed sidecar must not schedule work") },
    }

    // when
    const failed = await stepResearchCertification(stepInput(fixture, complete.certification_revision), dependencies)
    failPublication = false
    const published = await stepResearchCertification(stepInput(fixture, complete.certification_revision), dependencies)
    const adopted = await stepResearchCertification(stepInput(fixture, complete.certification_revision, campaign.state_revision), dependencies)

    // then
    expect(failed).toMatchObject({ kind: "error", error_code: "STORAGE_WRITE_FAILED" })
    expect(published).toMatchObject({ kind: "ok", state: { status: "COMPLETE" } })
    expect(adopted).toMatchObject({ kind: "ok", state: { status: "COMPLETE" } })
    expect(campaignWrites).toBe(1)
    expect(campaign.attachments).toHaveLength(1)
  })

  test("revalidates exact child bytes before final publication", async () => {
    // given
    const fixture = certifiedPromotionFixture()
    const initialized = await initializeResearchCertification({
      directory,
      campaign_id: fixture.campaign.campaign_id,
      expected_state_revision: fixture.campaign.state_revision,
    }, readers(fixture))
    if (initialized.kind !== "ok") throw new TypeError(initialized.message)
    const complete = completedState(initialized.state)
    const generation = generationRead(complete, fixture.campaign.state_revision)
    let childReads = 0
    let campaignWrites = 0

    // when
    const result = await stepResearchCertification(stepInput(fixture, complete.certification_revision), {
      ...readers(fixture),
      read_child: async () => {
        childReads += 1
        return { kind: "ok" as const, state: childReads === 1 ? fixture.child : {
          ...fixture.child,
          artifact: fixture.child.artifact === null ? null : { ...fixture.child.artifact, content: "changed" },
        } }
      },
      read_generation: async () => generation,
      read_attachment: async () => ({ kind: "ok" as const, state: complete, content_sha256: generation.content_sha256 }),
      compare_and_swap_campaign: async () => {
        campaignWrites += 1
        return { kind: "error" as const, error_code: "STORAGE_WRITE_FAILED" as const, message: "must not publish" }
      },
      plan_operation: () => { throw new TypeError("completed sidecar must not schedule work") },
      run_operation: async () => { throw new TypeError("completed sidecar must not schedule work") },
    })

    // then
    expect(result).toMatchObject({ kind: "error", error_code: "STALE_ARTIFACT" })
    expect(campaignWrites).toBe(0)
  })

  test("never adopts a completed sidecar after campaign abort", async () => {
    // given
    const fixture = certifiedPromotionFixture()
    const aborted = reduceCampaignTransition(fixture.campaign, { type: "ABORT", reason: "stop" })
    if (!aborted.ok) throw new TypeError(aborted.message)
    let campaignWrites = 0

    // when
    const result = await stepResearchCertification(stepInput(fixture, 3, aborted.state.state_revision), {
      ...readers(fixture),
      read_campaign: async () => ({ kind: "ok", state: aborted.state }),
      compare_and_swap_campaign: async () => {
        campaignWrites += 1
        return { kind: "error", error_code: "STORAGE_WRITE_FAILED", message: "must not adopt" }
      },
      plan_operation: () => { throw new TypeError("aborted campaign must not plan") },
      run_operation: async () => { throw new TypeError("aborted campaign must not run") },
    })

    // then
    expect(result).toMatchObject({ kind: "error", error_code: "CAMPAIGN_ABORTED" })
    expect(campaignWrites).toBe(0)
  })
})

function completedState(
  initialized: Extract<Awaited<ReturnType<typeof initializeResearchCertification>>, { readonly kind: "ok" }>["state"],
): ResearchCertificationStateV1 {
  const complete = ResearchCertificationStateV1Schema.parse(completeCertificationState())
  return {
    ...complete,
    campaign_id: initialized.campaign_id,
    certification_id: initialized.certification_id,
    generation_id: initialized.generation_id,
    selected_artifact: initialized.selected_artifact,
    objective_sha256: initialized.objective_sha256,
    profile_sha256: initialized.profile_sha256,
    reference_sha256: initialized.reference_sha256,
    certification_profile_sha256: initialized.certification_profile_sha256,
  }
}

function generationRead(state: ReturnType<typeof completedState>, initializedFromCampaignRevision: number) {
  return {
    kind: "ok" as const,
    state,
    index: buildCertificationGenerationIndex(state, initializedFromCampaignRevision),
    content_sha256: "c".repeat(64),
    index_content_sha256: "d".repeat(64),
  }
}

function stepInput(fixture: ReturnType<typeof certifiedPromotionFixture>, certificationRevision: number, stateRevision = fixture.campaign.state_revision) {
  return {
    directory: "",
    campaign_id: fixture.campaign.campaign_id,
    expected_state_revision: stateRevision,
    expected_certification_revision: certificationRevision,
    mode: "one_stage" as const,
  }
}

function readers(fixture: ReturnType<typeof certifiedPromotionFixture>) {
  return {
    ...applicationStorageWithoutCampaignGuard,
    read_campaign: async () => ({ kind: "ok" as const, state: fixture.campaign }),
    read_child: async () => ({ kind: "ok" as const, state: fixture.child }),
  }
}
