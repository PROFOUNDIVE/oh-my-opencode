import type { CertificationStepDependencies } from "../application/certification-scheduler-contract"
import type { CertificationContext } from "../application/certification-application-types"
import { planExtractionCoverageRound } from "./plan-extraction-coverage-round"
import { runExtractionCoverageRound } from "./run-extraction-coverage-round"
import { certificationRoundContextFromApplication } from "./certification-round-context"
import type { CertificationRoundRuntimeFactory, ExtractionCoverageOrchestrationInput } from "./extraction-coverage-types"

export function createExtractionCoverageRoundOrchestration(
  input: ExtractionCoverageOrchestrationInput,
): Readonly<{
  readonly plan_operation: (state: Parameters<CertificationStepDependencies["plan_operation"]>[0]) => ReturnType<typeof planExtractionCoverageRound>
  readonly run_operation: CertificationStepDependencies["run_operation"]
}> {
  return {
    plan_operation: (state) => planExtractionCoverageRound(state, input.context),
    run_operation: (operation) => runExtractionCoverageRound(operation, input),
  }
}

export function createApplicationExtractionCoverageOrchestration(
  context: CertificationContext,
  createJobRuntime: CertificationRoundRuntimeFactory,
) {
  return createExtractionCoverageRoundOrchestration({
    context: certificationRoundContextFromApplication(context),
    create_job_runtime: createJobRuntime,
  })
}
