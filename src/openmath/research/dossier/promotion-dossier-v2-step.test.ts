import { describe, expect, test } from "bun:test"

import { PromotionDossierV2Schema } from "./promotion-dossier-v2-schema"
import { promotionDossierV2Inputs } from "./promotion-dossier-v2-test-support"
import { preparePromotionDossier } from "./prepare-promotion-dossier"

describe("version-aware dossier preparation", () => {
  test("builds V2 only after rereading exact certification evidence", async () => {
    // given
    const input = promotionDossierV2Inputs()
    let certificationReads = 0
    const dependencies = {
      read_state: async () => ({ kind: "ok" as const, state: input.campaign }),
      read_child_state: async () => ({ kind: "ok" as const, state: input.child }),
      read_certification_evidence: async () => {
        certificationReads += 1
        return {
          kind: "ok" as const,
          state: input.certification,
          content_sha256: input.certification_content_sha256,
          observed_selected_artifact: input.certification.selected_artifact,
          artifact_content_sha256: input.certification.selected_artifact.artifact_sha256,
        }
      },
      compare_and_swap: async (request: Readonly<{ readonly next_state: typeof input.campaign }>) => ({
        kind: "ok" as const,
        state: request.next_state,
      }),
    }

    // when
    const result = await preparePromotionDossier({
      directory: "",
      campaign_id: input.campaign.campaign_id,
      expected_state_revision: input.campaign.state_revision,
    }, dependencies)

    // then
    expect(certificationReads).toBe(1)
    expect(result.kind).toBe("ok")
    if (result.kind !== "ok" || result.state.dossier === null) throw new TypeError("Missing V2 checkpoint")
    expect(PromotionDossierV2Schema.safeParse(JSON.parse(result.state.dossier.serialized_bytes)).success).toBe(true)
  })
})
