import { CertificationGraphSourcesSchema } from "../state/graph-source-validation"
import type { CertificationContext } from "../application/certification-application-types"
import type { ExtractionCoverageRoundContext } from "./extraction-coverage-types"

export function certificationRoundContextFromApplication(
  context: CertificationContext,
): ExtractionCoverageRoundContext {
  const certification = context.sources.profile.certification
  const artifact = context.child.artifact
  if (certification === undefined || artifact === null) throw new CertificationRoundContextError()
  return {
    parent_session_id: context.campaign.parent_session_id,
    profile_sha256: context.campaign.source_snapshot.profile.sha256,
    reference_sha256: context.campaign.source_snapshot.references.sha256,
    sources: CertificationGraphSourcesSchema.parse({
      artifact: context.state_identity,
      artifact_content: artifact.content,
      objective_sha256: context.campaign.source_snapshot.objective.sha256,
      objective_content: JSON.stringify(context.sources.objective),
      references: context.sources.references.references.map((reference) => ({
        source_id: reference.id,
        source_sha256: reference.sha256,
        content: reference.content,
      })),
    }),
    profile: context.profile,
    extraction_role: certification.extraction_role,
    coverage_role: certification.coverage_role,
  }
}

export class CertificationRoundContextError extends Error {
  readonly name = "CertificationRoundContextError"

  constructor() {
    super("Certification round requires a frozen profile and selected artifact")
  }
}
