import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import { promoteResearchCampaign, stepResearchCampaign } from "../application"
import {
  removeTemporaryCampaignDirectory,
  temporaryCampaignDirectory,
} from "../application/application-test-fixture"
import { createPassedCampaign } from "./dossier-test-support"
import { createPromotionDossierStepDependencies } from "./promotion-dossier-step"
import { readResearchCampaignState } from "../storage"

describe("terminal promotion decision", () => {
  let directory: string

  beforeEach(() => {
    directory = temporaryCampaignDirectory()
  })

  afterEach(() => {
    removeTemporaryCampaignDirectory(directory)
  })

  test.each([
    ["approve", "PROMOTION_READY"],
    ["reject", "REJECTED"],
  ] as const)("commits trusted %s to terminal %s with zero non-state side effects", async (decision, status) => {
    // given
    const checkpoint = await promotionCheckpoint(directory)
    const counters = sideEffectCounters()
    const dependencies = {
      trusted_actor_receipt: { session_id: "ses_human1", message_id: "msg_human1" },
      dispatch: counters.dispatch,
      amend_workflow: counters.amend_workflow,
      step_workflow: counters.step_workflow,
      write_canonical: counters.write_canonical,
      refine_authority: counters.refine_authority,
      schedule_continuation: counters.schedule_continuation,
    }

    // when
    const result = await promoteResearchCampaign({
      directory,
      campaign_id: checkpoint.campaign_id,
      expected_state_revision: checkpoint.state_revision,
      dossier_sha256: checkpoint.dossier_sha256,
      decision,
    }, dependencies)

    // then
    expect(result).toMatchObject({ ok: true, status, next_actions: [] })
    expect(counters.calls()).toEqual([0, 0, 0, 0, 0, 0])
    const stored = await readResearchCampaignState(directory, checkpoint.campaign_id)
    if (stored.kind !== "ok") throw new TypeError(stored.message)
    expect(stored.state.decision_receipt).toEqual({
      campaign_id: checkpoint.campaign_id,
      campaign_revision: checkpoint.state_revision,
      state_revision: checkpoint.state_revision + 1,
      dossier_sha256: checkpoint.dossier_sha256,
      decision,
      actor_session_id: "ses_human1",
      actor_message_id: "msg_human1",
    })
    if (result.ok) {
      expect(result.dossier).toMatchObject({
        canonical: false,
        mathematical_correctness_certified: false,
        human_approval_required: true,
      })
    }
  })

  test("fails closed for stale revision, missing or mismatched hash, forged actor input, and malformed decision", async () => {
    // given
    const checkpoint = await promotionCheckpoint(directory)
    const trusted = { trusted_actor_receipt: { session_id: "ses_human1", message_id: "msg_human1" } }
    const base = {
      directory,
      campaign_id: checkpoint.campaign_id,
      expected_state_revision: checkpoint.state_revision,
      dossier_sha256: checkpoint.dossier_sha256,
      decision: "approve",
    }

    // when
    const results = await Promise.all([
      promoteResearchCampaign({ ...base, expected_state_revision: checkpoint.state_revision - 1 }, trusted),
      promoteResearchCampaign({
        directory,
        campaign_id: checkpoint.campaign_id,
        expected_state_revision: checkpoint.state_revision,
        decision: "approve",
      }, trusted),
      promoteResearchCampaign({ ...base, dossier_sha256: "" }, trusted),
      promoteResearchCampaign({ ...base, dossier_sha256: "b".repeat(64) }, trusted),
      promoteResearchCampaign({ ...base, actor_session_id: "ses_forged" }, trusted),
      promoteResearchCampaign({ ...base, decision: "maybe" }, trusted),
      promoteResearchCampaign(base, { trusted_actor_receipt: { session_id: "", message_id: "" } }),
    ])

    // then
    expect(results.map((result) => result.ok && result.status)).toEqual([false, false, false, false, false, false, false])
  })

  test("permits exactly one winning decision under replay and race", async () => {
    // given
    const checkpoint = await promotionCheckpoint(directory)
    const request = {
      directory,
      campaign_id: checkpoint.campaign_id,
      expected_state_revision: checkpoint.state_revision,
      dossier_sha256: checkpoint.dossier_sha256,
      decision: "approve",
    } as const
    const trusted = { trusted_actor_receipt: { session_id: "ses_human1", message_id: "msg_human1" } }

    // when
    const raced = await Promise.all([
      promoteResearchCampaign(request, trusted),
      promoteResearchCampaign({ ...request, decision: "reject" }, trusted),
    ])
    const winner = raced.find((result) => result.ok)
    const replay = await promoteResearchCampaign({
      ...request,
      expected_state_revision: winner?.ok ? winner.state_revision : checkpoint.state_revision,
    }, trusted)

    // then
    expect(raced.filter((result) => result.ok)).toHaveLength(1)
    expect(replay).toMatchObject({ ok: false, error_code: "ILLEGAL_TRANSITION" })
  })
})

async function promotionCheckpoint(directory: string) {
  const passed = await createPassedCampaign(directory)
  const checkpoint = await stepResearchCampaign({
    directory,
    campaign_id: passed.campaign.campaign_id,
    expected_state_revision: passed.campaign.state_revision,
    mode: "one_stage",
  }, createPromotionDossierStepDependencies({ directory }))
  if (!checkpoint.ok || checkpoint.dossier === null) throw new TypeError("Promotion checkpoint is unavailable")
  return {
    campaign_id: checkpoint.campaign_id,
    state_revision: checkpoint.state_revision,
    dossier_sha256: checkpoint.dossier.content_sha256,
  }
}

function sideEffectCounters() {
  const calls = [0, 0, 0, 0, 0, 0]
  return {
    dispatch: () => { calls[0] += 1 },
    amend_workflow: () => { calls[1] += 1 },
    step_workflow: () => { calls[2] += 1 },
    write_canonical: () => { calls[3] += 1 },
    refine_authority: () => { calls[4] += 1 },
    schedule_continuation: () => { calls[5] += 1 },
    calls: () => calls,
  }
}
