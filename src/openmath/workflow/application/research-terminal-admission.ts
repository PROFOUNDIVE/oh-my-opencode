import {
  validateApprovedEducationalSource,
  type ApprovedEducationalSourceResult,
} from "../../research/educationalization/approved-source"
import type { WorkflowStateV1 } from "../state"

type AdmissionErrorCode = Exclude<ApprovedEducationalSourceResult, { readonly ok: true }>["error_code"] | "SOURCE_IDENTITY_MISMATCH"

export class ResearchTerminalAdmissionError extends Error {
  readonly name = "ResearchTerminalAdmissionError"

  constructor(readonly error_code: AdmissionErrorCode, message: string) {
    super(message)
  }
}

export async function admitResearchTerminalState(input: Readonly<{
  readonly directory: string
  readonly state: WorkflowStateV1
  readonly validate_source?: () => Promise<ApprovedEducationalSourceResult>
}>): Promise<void> {
  const request = input.state.request_snapshot
  if (input.state.status !== "PASSED" || request?.kind !== "research_educationalization") return
  const validated = await (input.validate_source ?? (() => validateApprovedEducationalSource({
    directory: input.directory,
    campaign_id: request.campaign_id,
    expected_state_revision: request.approved_campaign_revision,
    expected_certification_revision: request.certification.certification_revision,
    dossier_sha256: request.dossier_sha256,
  })))()
  if (!validated.ok) throw new ResearchTerminalAdmissionError(validated.error_code, validated.message)
  const { kind, ...persistedSource } = request
  if (kind !== "research_educationalization" || JSON.stringify(validated.source) !== JSON.stringify(persistedSource)) {
    throw new ResearchTerminalAdmissionError("SOURCE_IDENTITY_MISMATCH", "Approved research source changed before educational freeze")
  }
}
