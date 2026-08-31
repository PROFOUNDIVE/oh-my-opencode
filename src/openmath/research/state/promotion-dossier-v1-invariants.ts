import type { z } from "zod"

import { PromotionDossierV1Schema } from "../dossier/promotion-dossier-schema"
import type { AggregateInvariantInput } from "./aggregate-invariant-input"
import { addPromotionIssue, parsePromotionJson } from "./promotion-invariant-helpers"
import { validatePromotionDossierSemantics } from "./promotion-dossier-semantic-invariants"

export function validatePromotionDossierV1(
  state: AggregateInvariantInput,
  context: z.RefinementCtx,
): void {
  const reference = state.dossier
  if (reference === null) return
  const parsed = PromotionDossierV1Schema.safeParse(parsePromotionJson(reference.serialized_bytes))
  if (!parsed.success) {
    addPromotionIssue(context, ["dossier", "serialized_bytes"], "Dossier bytes must contain strict PromotionDossierV1 JSON")
    return
  }
  validatePromotionDossierSemantics(state, parsed.data, context)
}
