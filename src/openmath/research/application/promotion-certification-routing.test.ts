import { describe, expect, test } from "bun:test"

import {
  certifiedPromotionFixture,
  legacyPromotionFixture,
} from "../certification/application/certification-application-test-fixture"
import { readyCertificationState } from "../certification/state/certification-test-fixture"
import { completeCertificationState } from "../certification/state/complete-state-test-fixture"
import { buildCertificationAttachmentReference } from "../certification/state/attachment-reference"
import { ResearchCertificationStateV1Schema } from "../certification/state/schema"
import { ResearchCampaignStateV1Schema } from "../state"
import { routePromotionStep } from "./promotion-step-router"
import { stepResearchCampaign } from "./step-research-campaign"

describe("promotion certification routing", () => {
  test("routes an enabled READY promotion through certification instead of the V1 dossier", async () => {
    // given
    const directory = ""
    const fixture = certifiedPromotionFixture()
    let certificationCalls = 0
    let dossierCalls = 0
    const dependencies = {
      read_state: async () => ({ kind: "ok" as const, state: fixture.campaign }),
      prepare_dossier: async () => {
        dossierCalls += 1
        return { kind: "error" as const, error_code: "VALIDATION_ERROR" as const, message: "V1 dossier must not run" }
      },
      step_certification: async () => {
        certificationCalls += 1
        return { kind: "error" as const, error_code: "STALE_CERTIFICATION_REVISION" as const, message: "certification routed" }
      },
    }

    // when
    const result = await stepResearchCampaign({
      directory,
      campaign_id: fixture.campaign.campaign_id,
      expected_state_revision: fixture.campaign.state_revision,
      expected_certification_revision: null,
      mode: "one_stage",
    }, dependencies)

    // then
    expect(certificationCalls).toBe(1)
    expect(dossierCalls).toBe(0)
    expect(result).toMatchObject({ ok: false, message: "certification routed" })
  })

  test("preserves the legacy V1 dossier dependency without inspecting certification", async () => {
    // given
    const fixture = legacyPromotionFixture()
    let dossierCalls = 0
    let certificationCalls = 0

    // when
    const routed = await routePromotionStep({
      directory: "",
      campaign: fixture.campaign,
      mode: "one_stage",
      read_campaign: async () => ({ kind: "ok", state: fixture.campaign }),
    }, {
      prepare_dossier: async () => {
        dossierCalls += 1
        return { kind: "ok", state: fixture.campaign }
      },
      step_certification: async () => {
        certificationCalls += 1
        return { kind: "error", error_code: "VALIDATION_ERROR", message: "must not inspect sidecar" }
      },
    })

    // then
    expect(routed).toEqual({
      result: { kind: "ok", state: fixture.campaign },
      certification_result: null,
      certification_next_actions: null,
    })
    expect(dossierCalls).toBe(1)
    expect(certificationCalls).toBe(0)
  })

  test("derives enabled actions with both revisions after certification progress", async () => {
    // given
    const fixture = certifiedPromotionFixture()
    const certification = ResearchCertificationStateV1Schema.parse({
      ...readyCertificationState(),
      certification_revision: 4,
    })
    let receivedInput: unknown

    // when
    const routed = await routePromotionStep({
      directory: "",
      campaign: fixture.campaign,
      expected_certification_revision: 3,
      mode: "to_checkpoint",
      read_campaign: async () => ({ kind: "ok", state: fixture.campaign }),
    }, {
      prepare_dossier: async () => ({ kind: "error", error_code: "VALIDATION_ERROR", message: "must not build V1" }),
      step_certification: async (input) => {
        receivedInput = input
        return { kind: "ok", state: certification }
      },
    })

    // then
    expect(receivedInput).toMatchObject({
      expected_state_revision: fixture.campaign.state_revision,
      expected_certification_revision: 3,
      mode: "to_checkpoint",
    })
    expect(routed.certification_next_actions).toEqual([
      { action: "step_one_stage", required_state_revision: 10, required_certification_revision: 4, reason: "READY_TO_RUN" },
      { action: "step_to_checkpoint", required_state_revision: 10, required_certification_revision: 4, reason: "READY_TO_RUN" },
      { action: "amend", required_state_revision: 10, required_certification_revision: 4, reason: "READY_TO_RUN" },
      { action: "abort", required_state_revision: 10, required_certification_revision: 4, reason: "READY_TO_RUN" },
    ])
  })

  test("requires an explicit certification revision before enabled work", async () => {
    // given
    const fixture = certifiedPromotionFixture()
    let certificationCalls = 0

    // when
    const routed = await routePromotionStep({
      directory: "",
      campaign: fixture.campaign,
      mode: "one_stage",
      read_campaign: async () => ({ kind: "ok", state: fixture.campaign }),
    }, {
      prepare_dossier: async () => ({ kind: "error", error_code: "VALIDATION_ERROR", message: "must not build V1" }),
      step_certification: async () => {
        certificationCalls += 1
        return { kind: "error", error_code: "VALIDATION_ERROR", message: "must not run" }
      },
    })

    // then
    expect(routed.result).toMatchObject({ kind: "error", message: "Expected certification revision is required" })
    expect(certificationCalls).toBe(0)
  })

  test("propagates sidecar discovery failures without attempting a dossier", async () => {
    // given
    const fixture = certifiedPromotionFixture()
    let dossierCalls = 0

    // when
    const routed = await routePromotionStep({
      directory: "",
      campaign: fixture.campaign,
      expected_certification_revision: 2,
      mode: "one_stage",
      read_campaign: async () => ({ kind: "ok", state: fixture.campaign }),
    }, {
      prepare_dossier: async () => {
        dossierCalls += 1
        return { kind: "ok", state: fixture.campaign }
      },
      step_certification: async () => ({
        kind: "error",
        error_code: "STORAGE_READ_FAILED",
        reason: "UNREADABLE_REVISION",
        message: "corrupt highest certification revision",
      }),
    })

    // then
    expect(routed.result).toMatchObject({ kind: "error", error_code: "STORAGE_READ_FAILED" })
    expect(dossierCalls).toBe(0)
  })

  test("builds the enabled V2 dossier after COMPLETE sidecar attachment publication", async () => {
    // given
    const fixture = certifiedPromotionFixture()
    const complete = ResearchCertificationStateV1Schema.parse(completeCertificationState())
    const published = ResearchCampaignStateV1Schema.parse({
      ...fixture.campaign,
      attachments: [buildCertificationAttachmentReference({
        generation_id: complete.generation_id,
        certification_revision: complete.certification_revision,
        content_sha256: "f".repeat(64),
      })],
    })
    let dossierCalls = 0

    // when
    const routed = await routePromotionStep({
      directory: "",
      campaign: fixture.campaign,
      expected_certification_revision: complete.certification_revision,
      mode: "one_stage",
      read_campaign: async () => ({ kind: "ok", state: published }),
    }, {
      step_certification: async () => ({ kind: "ok", state: complete }),
      prepare_dossier: async () => {
        dossierCalls += 1
        return { kind: "ok", state: published }
      },
    })

    // then
    expect(dossierCalls).toBe(1)
    expect(routed.result).toEqual({ kind: "ok", state: published })
  })

})
