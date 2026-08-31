import { validateApprovedEducationalSource } from "../../openmath/research/educationalization/approved-source"
import { ResearchEducationalArtifactsSchema } from "../../openmath/workflow/adapters/research-educational-artifacts"
import { readWorkflowState } from "../../openmath/workflow/storage"
import { sha256 } from "../../openmath/workflow/stage-runner/sha256"
import { validateResearchPedagogicalPass } from "../../openmath/workflow/state/research-educationalization-invariants"
import type { FrozenArtifacts } from "../../openmath/types"

export async function getResearchFrozenArtifactsOrError(
  directory: string,
  educationalizationId: string,
): Promise<
  | { readonly ok: true; readonly artifacts: FrozenArtifacts; readonly originalProblemText?: string }
  | { readonly ok: false; readonly error_code: string; readonly message: string }
> {
  const read = await readWorkflowState(directory, educationalizationId)
  if (read.kind === "error") return { ok: false, error_code: "STATE_NOT_FOUND", message: read.message }
  const state = read.state
  const request = state.request_snapshot
  if (request?.kind !== "research_educationalization") {
    return { ok: false, error_code: "SOURCE_IDENTITY_MISMATCH", message: "Workflow is not a research educationalization" }
  }
  if (state.status !== "PASSED" || state.artifact === null || state.latest_review?.verdict !== "PASS") {
    return { ok: false, error_code: "ARTIFACTS_NOT_FROZEN", message: "Research educational artifacts have not passed pedagogical review" }
  }
  if (validateResearchPedagogicalPass(state).length > 0) {
    return { ok: false, error_code: "ARTIFACTS_MALFORMED", message: "Frozen research educational review provenance is inconsistent" }
  }
  const validated = await validateApprovedEducationalSource({
    directory,
    campaign_id: request.campaign_id,
    expected_state_revision: request.approved_campaign_revision,
    expected_certification_revision: request.certification.certification_revision,
    dossier_sha256: request.dossier_sha256,
  })
  if (!validated.ok) return validated
  const { kind: requestKind, ...persistedSource } = request
  if (requestKind !== "research_educationalization" || JSON.stringify(validated.source) !== JSON.stringify(persistedSource)) {
    return { ok: false, error_code: "SOURCE_IDENTITY_MISMATCH", message: "Approved research source no longer matches frozen educational provenance" }
  }
  if (state.artifact.media_type !== "application/vnd.openmath.legacy+json") {
    return { ok: false, error_code: "ARTIFACTS_MALFORMED", message: "Frozen research educational artifacts use an unsupported media type" }
  }
  if (sha256(state.artifact.content) !== state.artifact.sha256) {
    return { ok: false, error_code: "ARTIFACTS_MALFORMED", message: "Frozen research educational artifact hash does not match its content" }
  }
  const parsed = parseArtifacts(state.artifact.content)
  if (parsed === null || parsed.reference_solution !== request.reference_solution) {
    return { ok: false, error_code: "ARTIFACTS_MALFORMED", message: "Frozen research educational artifacts are malformed or changed the reference solution" }
  }
  const artifacts: FrozenArtifacts = {
    ...parsed,
    review_certificate: {
      certificate_kind: "research_pedagogical",
      artifact_version: String(state.artifact.version),
      review_round: state.latest_review.round,
      verdict: "PEDAGOGICAL_PASS",
      review_report_sha256: state.latest_review.raw_report_sha256,
      notes: "Pedagogical PASS only. The fixed research source remains non-canonical and is not a machine-checked proof.",
      provenance: {
        campaign_id: request.campaign_id,
        approved_campaign_revision: request.approved_campaign_revision,
        dossier_id: request.dossier_id,
        dossier_sha256: request.dossier_sha256,
        candidate_id: request.selected_artifact.candidate_id,
        child_run_id: request.selected_artifact.child_run_id,
        child_state_revision: request.selected_artifact.child_state_revision,
        source_artifact_version: request.selected_artifact.artifact_version,
        source_artifact_sha256: request.selected_artifact.artifact_sha256,
        certification_id: request.certification.certification_id,
        certification_generation_id: request.certification.generation_id,
        certification_revision: request.certification.certification_revision,
        certification_content_sha256: request.certification.content_sha256,
        certification_summary_sha256: request.certification.summary_sha256,
        remaining_uncertainties_sha256: request.remaining_uncertainties_sha256,
        reference_solution_sha256: request.reference_solution_sha256,
      },
      claims: {
        canonical: false,
        machine_checked: false,
        mathematical_correctness_certified: false,
      },
    },
  }
  return {
    ok: true,
    artifacts,
    ...(request.original_problem_text === undefined ? {} : { originalProblemText: request.original_problem_text }),
  }
}

function parseArtifacts(content: string) {
  try {
    const parsed = ResearchEducationalArtifactsSchema.safeParse(JSON.parse(content))
    return parsed.success ? parsed.data : null
  } catch (error) {
    if (error instanceof SyntaxError) return null
    throw error
  }
}
