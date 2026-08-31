import type { CertificationPromotionStepDependencies } from "../../application/promotion-step-router"
import type { CertificationStepDependencies } from "./certification-scheduler-contract"
import { stepResearchCertification } from "./step-research-certification"

export function createCertificationPromotionStep(
  dependencies: CertificationStepDependencies,
): CertificationPromotionStepDependencies {
  return {
    step_certification: (input) => stepResearchCertification(input, dependencies),
  }
}
