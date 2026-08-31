import { describe, expect, test } from "bun:test"

import { buildPromotionDossierV2 } from "../dossier/build-promotion-dossier-v2"
import { promotionDossierV2Inputs } from "../dossier/promotion-dossier-v2-test-support"
import { PromotionDecisionReceiptSchema, ResearchCampaignStateV1Schema } from "../state"
import { reduceCampaignTransition } from "./reduce-transition"

describe("PromotionDossierV2 decision gating", () => {
  test("approves only with exact current eligible certification evidence", () => {
    // given
    const input = promotionDossierV2Inputs()
    const state = checkpoint(input)
    const receipt = decisionReceipt(state, "approve")
    const evidence = approvalEvidence(input)

    // when
    const exact = reduceCampaignTransition(state, { type: "PROMOTE", decision_receipt: receipt, certification_evidence: evidence })
    const missing = reduceCampaignTransition(state, { type: "PROMOTE", decision_receipt: receipt })
    const staleHash = reduceCampaignTransition(state, {
      type: "PROMOTE",
      decision_receipt: receipt,
      certification_evidence: { ...evidence, content_sha256: "f".repeat(64) },
    })
    const secondDecision = exact.ok
      ? reduceCampaignTransition(exact.state, { type: "PROMOTE", decision_receipt: decisionReceipt(state, "reject") })
      : exact

    // then
    expect(exact).toMatchObject({ ok: true, state: { status: "PROMOTION_READY" } })
    expect(missing.ok).toBe(false)
    expect(staleHash.ok).toBe(false)
    expect(secondDecision.ok).toBe(false)
  })

  test.each(["INCONCLUSIVE", "CONFIRMED"] as const)("keeps %s inspectable and rejectable but not approvable", (outcome) => {
    // given
    const input = promotionDossierV2Inputs(outcome)
    const state = checkpoint(input)

    // when
    const approve = reduceCampaignTransition(state, {
      type: "PROMOTE",
      decision_receipt: decisionReceipt(state, "approve"),
      certification_evidence: approvalEvidence(input),
    })
    const reject = reduceCampaignTransition(state, {
      type: "PROMOTE",
      decision_receipt: decisionReceipt(state, "reject"),
    })

    // then
    expect(approve.ok).toBe(false)
    expect(reject).toMatchObject({ ok: true, state: { status: "REJECTED" } })
  })
})

function checkpoint(input: ReturnType<typeof promotionDossierV2Inputs>) {
  const built = buildPromotionDossierV2(input)
  if (!built.ok) throw new TypeError(built.message)
  return ResearchCampaignStateV1Schema.parse({
    ...input.campaign,
    state_revision: input.campaign.state_revision + 1,
    status: "AWAITING_HUMAN",
    awaiting_reason: "BEFORE_PROMOTION",
    dossier: built.reference,
  })
}

function decisionReceipt(
  state: ReturnType<typeof checkpoint>,
  decision: "approve" | "reject",
) {
  if (state.dossier === null) throw new TypeError("Missing V2 dossier")
  return PromotionDecisionReceiptSchema.parse({
    campaign_id: state.campaign_id,
    campaign_revision: state.state_revision,
    state_revision: state.state_revision + 1,
    dossier_sha256: state.dossier.content_sha256,
    decision,
    actor_session_id: "ses_human1",
    actor_message_id: "msg_human1",
  })
}

function approvalEvidence(input: ReturnType<typeof promotionDossierV2Inputs>) {
  return {
    state: input.certification,
    content_sha256: input.certification_content_sha256,
    observed_selected_artifact: input.certification.selected_artifact,
    artifact_content_sha256: input.certification.selected_artifact.artifact_sha256,
  }
}
