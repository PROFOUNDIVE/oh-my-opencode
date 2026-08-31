import { describe, expect, test } from "bun:test"

import { sha256 } from "../../workflow/stage-runner/sha256"
import { dossier } from "../state/promotion-test-fixture"
import { buildPromotionDossierV2 } from "./build-promotion-dossier-v2"
import { PromotionDossierV1Schema } from "./promotion-dossier-schema"
import { PromotionDossierV2Schema } from "./promotion-dossier-v2-schema"
import { promotionDossierV2Inputs } from "./promotion-dossier-v2-test-support"

describe("PromotionDossierV2 schema", () => {
  test("preserves the locked V2 key order and truth flags", () => {
    // given
    const input = v2Input()

    // when
    const parsed = PromotionDossierV2Schema.parse(input)

    // then
    expect(Object.keys(parsed)).toEqual([
      "schema_version", "dossier_id", "campaign_id", "created_at_revision", "selected_artifact",
      "objective_sha256", "profile_sha256", "reference_sha256", "candidate_lineage", "screen_receipts",
      "tournament_receipt", "child_workflow_review_evidence", "remaining_uncertainties", "certification_summary",
      "certification_attachment", "attachments", "canonical", "mathematical_correctness_certified",
      "human_approval_required",
    ])
    expect(parsed).toMatchObject({ canonical: false, mathematical_correctness_certified: false, human_approval_required: true })
  })

  test("requires complete uncertainty and witness summary fields plus one exact certification attachment", () => {
    // given
    const input = v2Input()
    const { witness_outcomes: _witnessOutcomes, ...summaryWithoutWitnesses } = input.certification_summary
    const duplicateAttachment = [...input.attachments, input.certification_attachment]

    // when
    const results = [
      PromotionDossierV2Schema.safeParse({ ...input, certification_summary: summaryWithoutWitnesses }),
      PromotionDossierV2Schema.safeParse({ ...input, remaining_uncertainties: {} }),
      PromotionDossierV2Schema.safeParse({ ...input, attachments: [] }),
      PromotionDossierV2Schema.safeParse({ ...input, attachments: duplicateAttachment }),
    ]

    // then
    expect(results.every((result) => !result.success)).toBe(true)
  })
})

test("builds identical V2 bytes and hashes from equivalent current inputs", () => {
  // given
  const input = promotionDossierV2Inputs()

  // when
  const first = buildPromotionDossierV2(input)
  const second = buildPromotionDossierV2(input)

  // then
  expect(first).toEqual(second)
  expect(first.ok).toBe(true)
  if (!first.ok) throw new TypeError(first.message)
  expect(String(first.reference.content_sha256)).toBe(sha256(first.reference.serialized_bytes))
  expect(first.dossier.certification_summary).toEqual(input.certification.summary)
  expect(first.dossier.attachments.filter((attachment) => (
    attachment.attachment_id === first.dossier.certification_attachment.attachment_id
  ))).toHaveLength(1)
})

test("fails V2 construction for stale sidecar hashes or selected artifact bytes", () => {
  // given
  const input = promotionDossierV2Inputs()
  const staleChild = {
    ...input.child,
    artifact: input.child.artifact === null ? null : { ...input.child.artifact, content: "stale content" },
  }

  // when
  const results = [
    buildPromotionDossierV2({ ...input, certification_content_sha256: "f".repeat(64) }),
    buildPromotionDossierV2({ ...input, child: staleChild }),
  ]

  // then
  expect(results.every((result) => !result.ok)).toBe(true)
})

function v2Input() {
  const reference = dossier()
  const v1 = PromotionDossierV1Schema.parse(JSON.parse(reference.serialized_bytes))
  const certificationAttachment = {
    attachment_id: `attachment-certification-${"b".repeat(64)}`,
    kind: "research-certification" as const,
    schema_version: 1 as const,
    content_sha256: "c".repeat(64),
    storage_ref: `certification/${"d".repeat(64)}/certification.rev-000000000003.json`,
  }
  return {
    ...v1,
    schema_version: 2 as const,
    certification_summary: {
      schema_version: 1 as const,
      certification_id: `certification-${"e".repeat(32)}`,
      generation_id: "d".repeat(64),
      certification_revision: 3,
      artifact_sha256: v1.selected_artifact.sha256,
      graph_sha256: "f".repeat(64),
      coverage_verdict: "PASS" as const,
      total_obligation_count: 1,
      required_obligation_count: 1,
      attack_outcomes: { counterexample_found: 0, no_counterexample_found: 1, invalid_target: 0, inconclusive: 0 },
      witness_outcomes: { confirmed: 0, rejected: 0, inconclusive: 0 },
      uncertainty_count: 0,
      approval_eligible: true,
    },
    certification_attachment: certificationAttachment,
    attachments: [...v1.attachments, certificationAttachment],
  }
}
