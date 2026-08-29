import { PromotionDecisionReceiptSchema } from "../state"
import { readResearchCampaignState } from "../storage"
import { reduceCampaignTransition } from "../transitions"
import { campaignErrorEnvelope } from "./campaign-envelope"
import type { CampaignApplicationResult } from "./campaign-application-result"
import type { CampaignMutationDependencies } from "./campaign-mutation-dependencies"
import { staleCampaignRevision, writeCampaignTransition } from "./commit-campaign-transition"
import { stateResultEnvelope } from "./state-result-envelope"
import {
  PromotionDecisionRequestSchema,
  TrustedPromotionActorReceiptSchema,
  type TrustedPromotionActorReceipt,
} from "./promotion-decision-request"

export type PromotionDecisionDependencies = CampaignMutationDependencies & Readonly<{
  readonly trusted_actor_receipt: TrustedPromotionActorReceipt
}>

export async function promoteResearchCampaign(input: unknown, dependencies: PromotionDecisionDependencies): Promise<CampaignApplicationResult> {
  const parsedInput = PromotionDecisionRequestSchema.safeParse(input)
  const actor = TrustedPromotionActorReceiptSchema.safeParse(dependencies.trusted_actor_receipt)
  if (!parsedInput.success) return campaignErrorEnvelope({ error_code: "VALIDATION_ERROR", message: parsedInput.error.message })
  if (!actor.success) return campaignErrorEnvelope({ error_code: "VALIDATION_ERROR", message: actor.error.message })
  const request = parsedInput.data
  const current = await (dependencies.read_state ?? readResearchCampaignState)(request.directory, request.campaign_id)
  if (current.kind === "error") return campaignErrorEnvelope(current)
  if (current.state.state_revision !== request.expected_state_revision) {
    return stateResultEnvelope(staleCampaignRevision(request.expected_state_revision, current.state.state_revision))
  }
  if (current.state.dossier === null || current.state.dossier.content_sha256 !== request.dossier_sha256) {
    return campaignErrorEnvelope({ error_code: "DOSSIER_HASH_MISMATCH", message: "Promotion dossier hash does not match" })
  }
  const decisionReceipt = PromotionDecisionReceiptSchema.safeParse({
    campaign_id: current.state.campaign_id,
    campaign_revision: current.state.state_revision,
    state_revision: current.state.state_revision + 1,
    dossier_sha256: request.dossier_sha256,
    decision: request.decision,
    actor_session_id: actor.data.session_id,
    actor_message_id: actor.data.message_id,
  })
  if (!decisionReceipt.success) {
    return campaignErrorEnvelope({ error_code: "VALIDATION_ERROR", message: decisionReceipt.error.message })
  }
  const transition = reduceCampaignTransition(current.state, {
    type: "PROMOTE",
    decision_receipt: decisionReceipt.data,
  })
  if (!transition.ok) return campaignErrorEnvelope({ error_code: transition.error_code, message: transition.message })
  return stateResultEnvelope(await writeCampaignTransition(request, transition.state, dependencies))
}
