import { getCertificationNextActions } from "../transitions"
import type { CertificationApplicationDependencies } from "./certification-application-dependencies"
import type { CertificationStatusResult } from "./certification-application-types"
import { readResearchCertification } from "./read-research-certification"

export async function getResearchCertificationStatus(
  input: Readonly<{ readonly directory: string; readonly campaign_id: string }>,
  dependencies: CertificationApplicationDependencies = {},
): Promise<CertificationStatusResult> {
  const result = await readResearchCertification(input, dependencies, { allow_aborted: true })
  if (result.kind !== "ok") return result
  const { context, read } = result
  if (read.kind === "not_started") {
    return {
      kind: "ok",
      campaign: context.campaign,
      state: null,
      content_sha256: null,
      effective_status: "NOT_STARTED",
      next_actions: getCertificationNextActions({
        effective_status: "NOT_STARTED",
        required_state_revision: context.campaign.state_revision,
        required_certification_revision: null,
        has_applicable_amendment: false,
      }),
    }
  }
  const effectiveStatus = context.campaign.status === "ABORTED"
    ? "ABORTED"
    : context.campaign.status === "AWAITING_HUMAN"
    && context.campaign.awaiting_reason === "BEFORE_PROMOTION"
    ? "BEFORE_PROMOTION"
    : read.state.status
  return {
    kind: "ok",
    campaign: context.campaign,
    state: read.state,
    content_sha256: read.content_sha256,
    effective_status: effectiveStatus,
    next_actions: getCertificationNextActions({
      effective_status: effectiveStatus,
      required_state_revision: context.campaign.state_revision,
      required_certification_revision: read.state.certification_revision,
      has_applicable_amendment: read.state.amendments.some((event) => event.event_type === "ADDED"),
    }),
  }
}
