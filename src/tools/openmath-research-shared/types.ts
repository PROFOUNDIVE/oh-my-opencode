import type { AgentOverrides, OpenMathConfig } from "../../config/schema"
import type {
  CampaignStepDependencies,
  CertificationPromotionStepDependencies,
} from "../../openmath/research/application"
import type { PromotionDossierStepDependencies } from "../../openmath/research/dossier"
import type { OpencodeClient, ToolContextWithMetadata } from "../delegate-task/types"

export type OpenMathResearchStepDependencies = CampaignStepDependencies
  & PromotionDossierStepDependencies
  & Partial<CertificationPromotionStepDependencies>

export type OpenMathResearchToolOptions = Readonly<{
  readonly directory: string
  readonly client?: OpencodeClient
  readonly openmathConfig: OpenMathConfig
  readonly pluginAgents?: AgentOverrides
  readonly createStepDependencies?: (
    context: ToolContextWithMetadata,
  ) => OpenMathResearchStepDependencies
}>
