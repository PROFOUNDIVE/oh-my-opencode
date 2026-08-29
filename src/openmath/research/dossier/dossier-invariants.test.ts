import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import { sha256 } from "../../workflow/stage-runner/sha256"
import { WorkflowStateV1Schema } from "../../workflow/state"
import {
  removeTemporaryCampaignDirectory,
  temporaryCampaignDirectory,
} from "../application/application-test-fixture"
import { ResearchCampaignStateV1Schema } from "../state"
import {
  compareAndSwapResearchCampaignState,
  readResearchCampaignState,
} from "../storage"
import { buildPromotionDossier } from "./build-promotion-dossier"
import { createPassedCampaign } from "./dossier-test-support"
import { createPromotionDossierStepDependencies } from "./promotion-dossier-step"
import { stepResearchCampaign } from "../application"
import { PromotionDossierV1Schema } from "./promotion-dossier-schema"

describe("promotion dossier dependency invariants", () => {
  let directory: string

  beforeEach(() => {
    directory = temporaryCampaignDirectory()
  })

  afterEach(() => {
    removeTemporaryCampaignDirectory(directory)
  })

  test("rejects malformed frozen sources, missing screens, stale artifact, and missing review evidence", async () => {
    // given
    const passed = await createPassedCampaign(directory)
    const staleChild = WorkflowStateV1Schema.parse({
      ...passed.child,
      artifact: passed.child.artifact === null ? null : { ...passed.child.artifact, sha256: "b".repeat(64) },
    })
    const reviewlessChild = WorkflowStateV1Schema.parse({ ...passed.child, review_history: [] })
    const mismatchedReviewChild = WorkflowStateV1Schema.parse({
      ...passed.child,
      latest_review: passed.child.latest_review === null
        ? null
        : { ...passed.child.latest_review, checks_performed: ["different-check"] },
    })

    // when
    const results = [
      buildPromotionDossier({
        campaign: {
          ...passed.campaign,
          source_snapshot: {
            ...passed.campaign.source_snapshot,
            profile: { ...passed.campaign.source_snapshot.profile, serialized_bytes: "{}" },
          },
        },
        child: passed.child,
      }),
      buildPromotionDossier({ campaign: { ...passed.campaign, screen_receipts: [] }, child: passed.child }),
      buildPromotionDossier({ campaign: passed.campaign, child: staleChild }),
      buildPromotionDossier({ campaign: passed.campaign, child: reviewlessChild }),
      buildPromotionDossier({ campaign: passed.campaign, child: mismatchedReviewChild }),
    ]

    // then
    expect(results.every((result) => !result.ok)).toBe(true)
  })

  test("binds lineage, tournament, attachments, refinement edge, and fixed truth flags", async () => {
    // given
    const passed = await createPassedCampaign(directory)
    const built = buildPromotionDossier(passed)
    if (!built.ok) throw new TypeError(built.message)
    const ready = promotionReadyState(passed.campaign, built.reference)
    const content = PromotionDossierV1Schema.parse(JSON.parse(built.reference.serialized_bytes))
    const forgedTruthBytes = JSON.stringify({ ...content, canonical: true })
    const refinement = [...ready.job_attempts].reverse().find((job) => (
      job.phase === "COMMITTED" && job.receipt.kind === "CANDIDATE_ARTIFACT"
      && job.receipt.refined_artifact !== undefined
    ))
    if (refinement?.phase !== "COMMITTED" || refinement.receipt.kind !== "CANDIDATE_ARTIFACT") {
      throw new TypeError("Refinement evidence is unavailable")
    }

    // when
    const results = [
      { ...ready, candidates: ready.candidates.map((candidate) => candidate.candidate_id === ready.selected_candidate_id ? { ...candidate, strategy_id: "mutated-strategy" } : candidate) },
      { ...ready, tournament_receipts: [] },
      { ...ready, attachments: [{ attachment_id: "attachment-extra", kind: "opaque", schema_version: 1, content_sha256: "a".repeat(64), storage_ref: "campaign://attachment-extra" }] },
      { ...ready, job_attempts: ready.job_attempts.map((job) => job.job_id === refinement.job_id ? { ...job, receipt: { ...refinement.receipt, refined_artifact: undefined } } : job) },
      { ...ready, dossier: { ...built.reference, serialized_bytes: forgedTruthBytes, content_sha256: sha256(forgedTruthBytes) } },
    ].map((state) => ResearchCampaignStateV1Schema.safeParse(state))

    // then
    expect(results.every((result) => !result.success)).toBe(true)
  })

  test("campaign CAS refuses to replace dossier bytes or hash after readiness", async () => {
    // given
    const passed = await createPassedCampaign(directory)
    const checkpoint = await stepResearchCampaign({
      directory,
      campaign_id: passed.campaign.campaign_id,
      expected_state_revision: passed.campaign.state_revision,
      mode: "one_stage",
    }, createPromotionDossierStepDependencies({ directory }))
    if (!checkpoint.ok) throw new TypeError(checkpoint.message)
    const stored = await readResearchCampaignState(directory, checkpoint.campaign_id)
    if (stored.kind !== "ok" || stored.state.dossier === null) throw new TypeError("Dossier state is unavailable")
    const content = PromotionDossierV1Schema.parse(JSON.parse(stored.state.dossier.serialized_bytes))
    const changedBytes = JSON.stringify({
      ...content,
      child_workflow_review_evidence: {
        ...content.child_workflow_review_evidence,
        review_history: content.child_workflow_review_evidence.review_history.map((review) => ({ ...review, raw_report: "changed" })),
      },
    })
    const mutatedState = ResearchCampaignStateV1Schema.parse({
      ...stored.state,
      dossier: { ...stored.state.dossier, serialized_bytes: changedBytes, content_sha256: sha256(changedBytes) },
    })

    // when
    const result = await compareAndSwapResearchCampaignState({
      directory,
      campaign_id: checkpoint.campaign_id,
      expected_state_revision: checkpoint.state_revision,
      next_state: mutatedState,
    })

    // then
    expect(result).toMatchObject({ kind: "error", error_code: "STORAGE_WRITE_FAILED" })
  })
})

function promotionReadyState(
  state: Awaited<ReturnType<typeof createPassedCampaign>>["campaign"],
  dossier: NonNullable<Awaited<ReturnType<typeof createPassedCampaign>>["campaign"]["dossier"]>,
) {
  return {
    ...state,
    state_revision: state.state_revision + 1,
    status: "AWAITING_HUMAN" as const,
    awaiting_reason: "BEFORE_PROMOTION" as const,
    dossier,
  }
}
