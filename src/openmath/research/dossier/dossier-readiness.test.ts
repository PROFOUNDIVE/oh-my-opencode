import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import { stepResearchCampaign } from "../application"
import {
  removeTemporaryCampaignDirectory,
  temporaryCampaignDirectory,
} from "../application/application-test-fixture"
import { ResearchCampaignStateV1Schema } from "../state"
import { readResearchCampaignState } from "../storage"
import { sha256 } from "../../workflow/stage-runner/sha256"
import { buildPromotionDossier } from "./build-promotion-dossier"
import { createPromotionDossierStepDependencies } from "./promotion-dossier-step"
import { createPassedCampaign } from "./dossier-test-support"
import { PromotionDossierV1Schema } from "./promotion-dossier-schema"

describe("immutable promotion dossier", () => {
  let directory: string

  beforeEach(() => {
    directory = temporaryCampaignDirectory()
  })

  afterEach(() => {
    removeTemporaryCampaignDirectory(directory)
  })

  test("serializes identical persisted evidence to byte-identical fixed-order bytes and SHA-256", async () => {
    // given
    const input = await createPassedCampaign(directory)

    // when
    const first = buildPromotionDossier(input)
    const second = buildPromotionDossier(input)

    // then
    expect(first).toEqual(second)
    expect(first.ok).toBe(true)
    if (!first.ok) throw new TypeError(first.message)
    const dossier = PromotionDossierV1Schema.parse(JSON.parse(first.reference.serialized_bytes))
    expect(Object.keys(dossier)).toEqual([
      "schema_version",
      "dossier_id",
      "campaign_id",
      "created_at_revision",
      "selected_artifact",
      "objective_sha256",
      "profile_sha256",
      "reference_sha256",
      "candidate_lineage",
      "screen_receipts",
      "tournament_receipt",
      "child_workflow_review_evidence",
      "remaining_uncertainties",
      "attachments",
      "canonical",
      "mathematical_correctness_certified",
      "human_approval_required",
    ])
    expect(first.reference.content_sha256).toBe(sha256(first.reference.serialized_bytes))
    expect(dossier).toMatchObject({
      canonical: false,
      mathematical_correctness_certified: false,
      human_approval_required: true,
    })
  })

  test("persists exact dossier bytes before pausing and never crosses BEFORE_PROMOTION", async () => {
    // given
    const passed = await createPassedCampaign(directory)

    // when
    const ready = await stepResearchCampaign({
      directory,
      campaign_id: passed.campaign.campaign_id,
      expected_state_revision: passed.campaign.state_revision,
      mode: "to_checkpoint",
    }, createPromotionDossierStepDependencies({ directory }))

    // then
    expect(ready).toMatchObject({
      ok: true,
      status: "AWAITING_HUMAN",
      awaiting_reason: "BEFORE_PROMOTION",
      next_actions: [{ action: "promote" }, { action: "abort" }],
    })
    const stored = await readResearchCampaignState(directory, passed.campaign.campaign_id)
    if (stored.kind !== "ok") throw new TypeError(stored.message)
    expect(stored.state.dossier?.serialized_bytes).toBeTruthy()
    expect(ResearchCampaignStateV1Schema.safeParse(stored.state).success).toBe(true)
    const replay = await stepResearchCampaign({
      directory,
      campaign_id: passed.campaign.campaign_id,
      expected_state_revision: stored.state.state_revision,
      mode: "one_stage",
    }, createPromotionDossierStepDependencies({ directory }))
    expect(replay).toMatchObject({ ok: false, error_code: "ILLEGAL_TRANSITION" })
  })

  test("rejects dossier readiness when persisted dependencies or truth flags are mutated", async () => {
    // given
    const passed = await createPassedCampaign(directory)
    const built = buildPromotionDossier(passed)
    if (!built.ok) throw new TypeError(built.message)
    const ready = {
      ...passed.campaign,
      state_revision: passed.campaign.state_revision + 1,
      status: "AWAITING_HUMAN",
      awaiting_reason: "BEFORE_PROMOTION",
      dossier: built.reference,
    }
    const serialized = PromotionDossierV1Schema.parse(JSON.parse(built.reference.serialized_bytes))

    // when
    const results = [
      { ...ready, source_snapshot: { ...ready.source_snapshot, profile: { ...ready.source_snapshot.profile, sha256: "b".repeat(64) } } },
      { ...ready, screen_receipts: ready.screen_receipts.slice(1) },
      { ...ready, dossier: { ...built.reference, serialized_bytes: JSON.stringify({ ...serialized, canonical: true }) } },
    ].map((state) => ResearchCampaignStateV1Schema.safeParse(state))

    // then
    expect(results.every((result) => !result.success)).toBe(true)
  })
})
