import type { CertificationStepDependencies } from "../application/certification-scheduler-contract"
import type { CertificationContext } from "../application/certification-application-types"
import { planWitnessVerification } from "./plan-witness-verification"
import { runWitnessVerification } from "./run-witness-verification"
import { witnessVerificationContextFromApplication } from "./witness-verification-context"
import type { CertificationRoundRuntimeFactory } from "./extraction-coverage-types"
import type { WitnessVerificationOrchestrationInput } from "./witness-verification-types"

export function createWitnessVerificationOrchestration(
  input: WitnessVerificationOrchestrationInput,
): Readonly<{
  readonly plan_operation: (state: Parameters<CertificationStepDependencies["plan_operation"]>[0]) => ReturnType<typeof planWitnessVerification>
  readonly run_operation: CertificationStepDependencies["run_operation"]
}> {
  return {
    plan_operation: (state) => planWitnessVerification(state, input.context),
    run_operation: (operation) => runWitnessVerification(operation, input),
  }
}

export function createApplicationWitnessVerificationOrchestration(
  context: CertificationContext,
  createJobRuntime: CertificationRoundRuntimeFactory,
) {
  return createWitnessVerificationOrchestration({
    context: witnessVerificationContextFromApplication(context),
    create_job_runtime: createJobRuntime,
  })
}
