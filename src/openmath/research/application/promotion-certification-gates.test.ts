import { describe, expect, test } from "bun:test"

import { certifiedPromotionFixture } from "../certification/application/certification-application-test-fixture"
import { completeCertificationState } from "../certification/state/complete-state-test-fixture"
import { readyCertificationState } from "../certification/state/certification-test-fixture"
import { ResearchCertificationStateV1Schema } from "../certification/state/schema"
import { routePromotionStep } from "./promotion-step-router"
import { stepResearchCampaign } from "./step-research-campaign"

describe("promotion certification gates", () => {
  test("enabled routing does not require the legacy dossier dependency", async () => {
    // given
    const fixture = certifiedPromotionFixture()
    let certificationCalls = 0
    const dependencies = {
      read_state: async () => ({ kind: "ok" as const, state: fixture.campaign }),
      step_certification: async () => {
        certificationCalls += 1
        return { kind: "error" as const, error_code: "STORAGE_BUSY" as const, message: "owned" }
      },
    }

    // when
    const result = await stepResearchCampaign({
      directory: "",
      campaign_id: fixture.campaign.campaign_id,
      expected_state_revision: fixture.campaign.state_revision,
      expected_certification_revision: null,
      mode: "one_stage",
    }, dependencies)

    // then
    expect(certificationCalls).toBe(1)
    expect(result).toMatchObject({ ok: false, error_code: "STORAGE_BUSY", message: "owned" })
  })

  test("to_checkpoint delegates continuation once and never crosses into dossier construction", async () => {
    // given
    const fixture = certifiedPromotionFixture()
    const certification = ResearchCertificationStateV1Schema.parse(readyCertificationState())
    let certificationCalls = 0
    let dossierCalls = 0
    const dependencies = {
      read_state: async () => ({ kind: "ok" as const, state: fixture.campaign }),
      prepare_dossier: async () => {
        dossierCalls += 1
        return { kind: "ok" as const, state: fixture.campaign }
      },
      step_certification: async () => {
        certificationCalls += 1
        return { kind: "ok" as const, state: certification }
      },
    }

    // when
    const result = await stepResearchCampaign({
      directory: "",
      campaign_id: fixture.campaign.campaign_id,
      expected_state_revision: fixture.campaign.state_revision,
      expected_certification_revision: null,
      mode: "to_checkpoint",
    }, dependencies)

    // then
    expect(result).toMatchObject({ ok: true, status: "READY", phase: "PROMOTION" })
    expect(certificationCalls).toBe(1)
    expect(dossierCalls).toBe(0)
  })

  test("retains the independently validated certification revision failure", async () => {
    // given
    const fixture = certifiedPromotionFixture()

    // when
    const routed = await routePromotionStep({
      directory: "",
      campaign: fixture.campaign,
      expected_certification_revision: 1,
      mode: "one_stage",
      read_campaign: async () => ({ kind: "ok", state: fixture.campaign }),
    }, {
      prepare_dossier: async () => ({ kind: "error", error_code: "VALIDATION_ERROR", message: "must not build V1" }),
      step_certification: async () => ({
        kind: "error",
        error_code: "STALE_CERTIFICATION_REVISION",
        message: "Expected certification revision 1, found 2",
        current_certification_revision: 2,
      }),
    })

    // then
    expect(routed.certification_result).toMatchObject({
      kind: "error",
      error_code: "STALE_CERTIFICATION_REVISION",
      current_certification_revision: 2,
    })
  })

  test("keeps COMPLETE without an attachment at the publication gate", async () => {
    // given
    const fixture = certifiedPromotionFixture()
    const certification = ResearchCertificationStateV1Schema.parse(completeCertificationState())

    // when
    const routed = await routePromotionStep({
      directory: "",
      campaign: fixture.campaign,
      expected_certification_revision: certification.certification_revision,
      mode: "one_stage",
      read_campaign: async () => ({ kind: "ok", state: fixture.campaign }),
    }, {
      prepare_dossier: async () => ({ kind: "error", error_code: "VALIDATION_ERROR", message: "must not build V1" }),
      step_certification: async () => ({ kind: "ok", state: certification }),
    })

    // then
    expect(routed.result).toEqual({ kind: "ok", state: fixture.campaign })
    expect(routed.certification_next_actions).toEqual([
      { action: "step_one_stage", required_state_revision: 10, required_certification_revision: 3, reason: "PUBLICATION_REQUIRED" },
      { action: "abort", required_state_revision: 10, required_certification_revision: 3, reason: "PUBLICATION_REQUIRED" },
    ])
  })
})
