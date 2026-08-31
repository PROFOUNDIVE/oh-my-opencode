import { describe, expect, test } from "bun:test"

import { certifiedPromotionFixture } from "../certification/application/certification-application-test-fixture"
import { buildCertificationAttachmentReference } from "../certification/state/attachment-reference"
import { CertificationSelectedArtifactSchema, deriveCertificationIdentity } from "../certification/state/identity"
import { reduceCampaignTransition } from "./reduce-transition"

describe("certification attachment publication transition", () => {
  test("appends only the exact derived attachment for an enabled live promotion", () => {
    // given
    const { campaign } = certifiedPromotionFixture()
    const selected = campaign.candidates.find((candidate) => candidate.candidate_id === campaign.selected_candidate_id)
    if (selected?.artifact === null || selected?.artifact === undefined || selected.child_state_revision === null) {
      throw new TypeError("Expected selected artifact")
    }
    const profile = JSON.parse(campaign.source_snapshot.profile.serialized_bytes)
    const certificationProfileSha256 = profile.certification?.certification_profile_hash
    if (typeof certificationProfileSha256 !== "string") throw new TypeError("Expected certification profile")
    const selectedArtifact = CertificationSelectedArtifactSchema.parse({
      candidate_id: selected.candidate_id,
      child_run_id: selected.child_run_id,
      child_state_revision: selected.child_state_revision,
      artifact_version: selected.artifact.artifact_version,
      media_type: selected.artifact.media_type,
      artifact_sha256: selected.artifact.sha256,
    })
    const identity = deriveCertificationIdentity({
      campaign_id: campaign.campaign_id,
      selected_artifact_sha256: selectedArtifact.artifact_sha256,
      certification_profile_sha256: certificationProfileSha256,
    })
    const attachment = buildCertificationAttachmentReference({
      generation_id: identity.generation_id,
      certification_revision: 3,
      content_sha256: "f".repeat(64),
    })

    // when
    const result = reduceCampaignTransition(campaign, {
      type: "PUBLISH_CERTIFICATION_ATTACHMENT",
      selected_artifact: selectedArtifact,
      certification_profile_sha256: certificationProfileSha256,
      generation_id: identity.generation_id,
      certification_revision: 3,
      attachment,
    })

    // then
    expect(result).toMatchObject({ ok: true, state: { state_revision: campaign.state_revision + 1, attachments: [attachment] } })
  })

  test("rejects a caller-supplied alternate storage reference", () => {
    // given
    const { campaign } = certifiedPromotionFixture()
    const selected = campaign.candidates.find((candidate) => candidate.candidate_id === campaign.selected_candidate_id)
    if (selected?.artifact === null || selected?.artifact === undefined || selected.child_state_revision === null) {
      throw new TypeError("Expected selected artifact")
    }
    const profile = JSON.parse(campaign.source_snapshot.profile.serialized_bytes)
    const certificationProfileSha256 = profile.certification?.certification_profile_hash
    if (typeof certificationProfileSha256 !== "string") throw new TypeError("Expected certification profile")
    const selectedArtifact = CertificationSelectedArtifactSchema.parse({
      candidate_id: selected.candidate_id,
      child_run_id: selected.child_run_id,
      child_state_revision: selected.child_state_revision,
      artifact_version: selected.artifact.artifact_version,
      media_type: selected.artifact.media_type,
      artifact_sha256: selected.artifact.sha256,
    })
    const identity = deriveCertificationIdentity({
      campaign_id: campaign.campaign_id,
      selected_artifact_sha256: selectedArtifact.artifact_sha256,
      certification_profile_sha256: certificationProfileSha256,
    })
    const attachment = {
      ...buildCertificationAttachmentReference({
        generation_id: identity.generation_id,
        certification_revision: 3,
        content_sha256: "f".repeat(64),
      }),
      storage_ref: "../alternate.json",
    }

    // when
    const result = reduceCampaignTransition(campaign, {
      type: "PUBLISH_CERTIFICATION_ATTACHMENT",
      selected_artifact: selectedArtifact,
      certification_profile_sha256: certificationProfileSha256,
      generation_id: identity.generation_id,
      certification_revision: 3,
      attachment,
    })

    // then
    expect(result).toMatchObject({ ok: false, error_code: "VALIDATION_ERROR" })
  })
})
