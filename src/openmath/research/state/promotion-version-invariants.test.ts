import { describe, expect, test } from "bun:test"

import { sha256 } from "../../workflow/stage-runner/sha256"
import { buildPromotionDossier } from "../dossier/build-promotion-dossier"
import { buildPromotionDossierV2 } from "../dossier/build-promotion-dossier-v2"
import { promotionDossierV2Inputs } from "../dossier/promotion-dossier-v2-test-support"
import { PromotionDossierV2Schema } from "../dossier/promotion-dossier-v2-schema"
import { PromotionDossierReferenceSchema } from "./promotion-references"
import { ResearchCampaignStateV1Schema } from "./schema"

describe("profile-gated promotion dossier versions", () => {
  test("accepts only V2 for a certification-enabled frozen profile", () => {
    // given
    const input = promotionDossierV2Inputs()
    const v1 = buildPromotionDossier(input)
    const v2 = buildPromotionDossierV2(input)
    if (!v1.ok || !v2.ok) throw new TypeError("Expected dossier fixtures")

    // when
    const v1State = ResearchCampaignStateV1Schema.safeParse(checkpoint(input.campaign, v1.reference))
    const v2State = ResearchCampaignStateV1Schema.safeParse(checkpoint(input.campaign, v2.reference))

    // then
    expect(v1State.success).toBe(false)
    expect(v2State.success).toBe(true)
  })

  test("rejects a V2 summary or attachment that diverges from current certification evidence", () => {
    // given
    const input = promotionDossierV2Inputs()
    const built = buildPromotionDossierV2(input)
    if (!built.ok) throw new TypeError(built.message)
    const content = JSON.parse(built.reference.serialized_bytes)
    const staleSummaryBytes = JSON.stringify({
      ...content,
      certification_summary: { ...content.certification_summary, certification_revision: content.certification_summary.certification_revision + 1 },
    })

    // when
    const result = ResearchCampaignStateV1Schema.safeParse(checkpoint(input.campaign, PromotionDossierReferenceSchema.parse({
      ...built.reference,
      serialized_bytes: staleSummaryBytes,
      content_sha256: sha256(staleSummaryBytes),
    })))

    // then
    expect(result.success).toBe(false)
  })

  test("rejects forged approval eligibility that contradicts visible witness outcomes", () => {
    // given
    const input = promotionDossierV2Inputs("INCONCLUSIVE")
    const built = buildPromotionDossierV2(input)
    if (!built.ok) throw new TypeError(built.message)
    const content = PromotionDossierV2Schema.parse(JSON.parse(built.reference.serialized_bytes))
    const forgedBytes = JSON.stringify({
      ...content,
      certification_summary: { ...content.certification_summary, approval_eligible: true },
    })

    // when
    const result = ResearchCampaignStateV1Schema.safeParse(checkpoint(input.campaign, PromotionDossierReferenceSchema.parse({
      ...built.reference,
      serialized_bytes: forgedBytes,
      content_sha256: sha256(forgedBytes),
    })))

    // then
    expect(result.success).toBe(false)
  })
})

function checkpoint(
  campaign: ReturnType<typeof promotionDossierV2Inputs>["campaign"],
  dossier: NonNullable<ReturnType<typeof promotionDossierV2Inputs>["campaign"]["dossier"]>,
) {
  return {
    ...campaign,
    state_revision: campaign.state_revision + 1,
    status: "AWAITING_HUMAN" as const,
    awaiting_reason: "BEFORE_PROMOTION" as const,
    dossier,
  }
}
