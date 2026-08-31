import { describe, expect, test } from "bun:test"

import { preparePromotionDossier } from "../dossier/prepare-promotion-dossier"
import { promotionDossierV2Inputs } from "../dossier/promotion-dossier-v2-test-support"
import { promoteResearchCampaign } from "./promote-research-campaign"

describe("enabled promotion command", () => {
  test.each([
    ["malformed decision", {
      directory: ".",
      campaign_id: "campaign-1",
      expected_state_revision: 0,
      dossier_sha256: "b".repeat(64),
      decision: "maybe",
    }],
    ["extra key", {
      directory: ".",
      campaign_id: "campaign-1",
      expected_state_revision: 0,
      dossier_sha256: "b".repeat(64),
      decision: "reject",
      unexpected: true,
    }],
    ["omitted decision", {
      directory: ".",
      campaign_id: "campaign-1",
      expected_state_revision: 0,
      dossier_sha256: "b".repeat(64),
    }],
  ])("rejects %s before reading campaign state", async (_case, request) => {
    // given
    let stateReads = 0

    // when
    const result = await promoteResearchCampaign(request, {
      trusted_actor_receipt: { session_id: "ses_human1", message_id: "msg_human1" },
      read_state: async () => {
        stateReads += 1
        return { kind: "error", error_code: "STORAGE_READ_FAILED", message: "must not read" }
      },
    })

    // then
    expect(stateReads).toBe(0)
    expect(result).toMatchObject({ ok: false, error_code: "VALIDATION_ERROR" })
  })

  test("rejects from persisted V2 bytes without rereading a lost sidecar", async () => {
    // given
    const input = promotionDossierV2Inputs()
    const checkpoint = await dossierCheckpoint(input)
    let evidenceReads = 0

    // when
    const result = await promoteResearchCampaign({
      directory: ".",
      campaign_id: checkpoint.campaign_id,
      expected_state_revision: checkpoint.state_revision,
      expected_certification_revision: input.certification.certification_revision,
      dossier_sha256: checkpoint.dossier?.content_sha256,
      decision: "reject",
    }, {
      trusted_actor_receipt: { session_id: "ses_human1", message_id: "msg_human1" },
      read_state: async () => ({ kind: "ok", state: checkpoint }),
      compare_and_swap: async (request) => ({ kind: "ok", state: request.next_state }),
      read_certification_evidence: async () => {
        evidenceReads += 1
        return { kind: "error", message: "sidecar lost" }
      },
    })

    // then
    expect(result).toMatchObject({
      ok: true,
      status: "REJECTED",
      certification: {
        status: "COMPLETE",
        certification_revision: input.certification.certification_revision,
      },
    })
    expect(evidenceReads).toBe(0)
  })

  test("approves only after rereading the exact requested certification revision", async () => {
    // given
    const input = promotionDossierV2Inputs()
    const checkpoint = await dossierCheckpoint(input)

    // when
    const result = await promoteResearchCampaign({
      directory: ".",
      campaign_id: checkpoint.campaign_id,
      expected_state_revision: checkpoint.state_revision,
      expected_certification_revision: input.certification.certification_revision,
      dossier_sha256: checkpoint.dossier?.content_sha256,
      decision: "approve",
    }, {
      trusted_actor_receipt: { session_id: "ses_human1", message_id: "msg_human1" },
      read_state: async () => ({ kind: "ok", state: checkpoint }),
      compare_and_swap: async (request) => ({ kind: "ok", state: request.next_state }),
      read_certification_evidence: async () => ({
        kind: "ok",
        state: input.certification,
        content_sha256: input.certification_content_sha256,
        observed_selected_artifact: input.certification.selected_artifact,
        artifact_content_sha256: input.certification.selected_artifact.artifact_sha256,
      }),
    })

    // then
    expect(result).toMatchObject({
      ok: true,
      status: "PROMOTION_READY",
      certification: { certification_revision: input.certification.certification_revision },
    })
  })

  test("uses the enabled error envelope for dossier hash mismatch", async () => {
    const input = promotionDossierV2Inputs()
    const checkpoint = await dossierCheckpoint(input)

    const result = await promoteResearchCampaign({
      directory: ".",
      campaign_id: checkpoint.campaign_id,
      expected_state_revision: checkpoint.state_revision,
      expected_certification_revision: input.certification.certification_revision,
      dossier_sha256: "b".repeat(64),
      decision: "reject",
    }, {
      trusted_actor_receipt: { session_id: "ses_human1", message_id: "msg_human1" },
      read_state: async () => ({ kind: "ok", state: checkpoint }),
    })

    expect(result).toEqual({ ok: false, error_code: "DOSSIER_HASH_MISMATCH", message: "Promotion dossier hash does not match" })
  })
})

async function dossierCheckpoint(input: ReturnType<typeof promotionDossierV2Inputs>) {
  const result = await preparePromotionDossier({
    directory: ".",
    campaign_id: input.campaign.campaign_id,
    expected_state_revision: input.campaign.state_revision,
  }, {
    read_state: async () => ({ kind: "ok", state: input.campaign }),
    read_child_state: async () => ({ kind: "ok", state: input.child }),
    read_certification_evidence: async () => ({
      kind: "ok",
      state: input.certification,
      content_sha256: input.certification_content_sha256,
      observed_selected_artifact: input.certification.selected_artifact,
      artifact_content_sha256: input.certification.selected_artifact.artifact_sha256,
    }),
    compare_and_swap: async (request) => ({ kind: "ok", state: request.next_state }),
  })
  if (result.kind !== "ok" || result.state.dossier === null) throw new TypeError("V2 checkpoint is unavailable")
  return result.state
}
