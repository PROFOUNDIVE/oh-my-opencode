import type { CampaignStateResult } from "../application/campaign-application-result"
import type { PreparePromotionDossierDependencies } from "./prepare-promotion-dossier"
import { preparePromotionDossier } from "./prepare-promotion-dossier"

export type PromotionDossierStepDependencies = Readonly<{
  readonly prepare_dossier: (input: Readonly<{
    readonly directory: string
    readonly campaign_id: string
    readonly expected_state_revision: number
  }>) => Promise<CampaignStateResult>
}>

export function createPromotionDossierStepDependencies(input: Readonly<{
  readonly directory: string
  readonly infrastructure?: PreparePromotionDossierDependencies
}>): PromotionDossierStepDependencies {
  return {
    prepare_dossier: (request) => preparePromotionDossier(
      { ...request, directory: input.directory },
      input.infrastructure,
    ),
  }
}
