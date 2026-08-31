import { sha256 } from "../../../workflow/stage-runner/sha256"

export const HASH_A = "1".repeat(64)
export const HASH_B = "2".repeat(64)
export const HASH_C = "3".repeat(64)
export const HASH_D = "4".repeat(64)
export const HASH_E = "5".repeat(64)

export const CERTIFICATION_ID = "certification-4f7eb0095b9e9df251ff23e1ddbdf95a"
export const GENERATION_ID = "4f7eb0095b9e9df251ff23e1ddbdf95a07db2a4a86f38b449224957bb66739f3"

export function selectedArtifact(artifactSha256 = HASH_A) {
  return {
    candidate_id: "candidate-01",
    child_run_id: "campaign-a::candidate-01",
    child_state_revision: 7,
    artifact_version: 2,
    media_type: "text/markdown",
    artifact_sha256: artifactSha256,
  }
}

export function readyCertificationState() {
  return {
    schema_version: 1,
    certification_id: CERTIFICATION_ID,
    generation_id: GENERATION_ID,
    campaign_id: "campaign-a",
    selected_artifact: selectedArtifact(),
    objective_sha256: HASH_C,
    profile_sha256: HASH_D,
    reference_sha256: HASH_E,
    certification_profile_sha256: HASH_B,
    certification_revision: 0,
    phase: "EXTRACTION",
    status: "READY",
    awaiting_reason: null,
    abort_requested: false,
    abort_reason: null,
    blocked_reason: null,
    active_job_ids: [],
    graphs: [],
    coverage_reviews: [],
    attack_attempts: [],
    witness_verifications: [],
    evidence_receipts: [],
    amendments: [],
    job_attempts: [],
    summary: null,
    finalization: null,
  }
}

const ARTIFACT = "Theorem\nLemma\nClaim\nDefinition\nImported\nComputation"
const OBJECTIVE = "Prove the theorem."
const REFERENCE = "Frozen reference theorem."

export function mixedGraphFixture() {
  const artifact = selectedArtifact(sha256(ARTIFACT))
  const assumptionCores = [
    {
      assumption_id: "assumption-0001",
      statement: "The artifact definitions are fixed.",
      source_kind: "ARTIFACT",
      source_id: artifact.candidate_id,
      source_sha256: artifact.artifact_sha256,
      source_span: null,
    },
    {
      assumption_id: "assumption-0002",
      statement: "The objective asks for this theorem.",
      source_kind: "OBJECTIVE",
      source_id: "objective",
      source_sha256: sha256(OBJECTIVE),
      source_span: null,
    },
    {
      assumption_id: "assumption-0003",
      statement: "The imported theorem is available.",
      source_kind: "REFERENCE",
      source_id: "reference-01",
      source_sha256: sha256(REFERENCE),
      source_span: null,
    },
  ]
  const assumptions = assumptionCores.map((assumption) => ({
    ...assumption,
    assumption_sha256: sha256(JSON.stringify(assumption)),
  }))
  const statements = ["Theorem", "Lemma", "Claim", "Definition", "Imported", "Computation"]
  const kinds = ["THEOREM", "LEMMA", "CLAIM", "DEFINITION", "IMPORTED_RESULT", "COMPUTATION"]
  const nodes = statements.map((statement, index) => {
    const startByte = ARTIFACT.indexOf(statement)
    const sourceSpan = {
      start_byte: startByte,
      end_byte: startByte + statement.length,
      span_sha256: sha256(statement),
    }
    const obligationId = `obligation-${String(index + 1).padStart(4, "0")}`
    const prerequisiteIds = index === 0
      ? statements.slice(1).map((_, childIndex) => `obligation-${String(childIndex + 2).padStart(4, "0")}`)
      : []
    const assumption = assumptions[index === 4 ? 2 : index % 2]
    if (assumption === undefined) throw new TypeError("Missing test assumption")
    const core = {
      obligation_id: obligationId,
      kind: kinds[index],
      source_span: sourceSpan,
      statement,
      prerequisite_ids: prerequisiteIds,
      assumption_bindings: [{
        assumption_id: assumption.assumption_id,
        assumption_sha256: assumption.assumption_sha256,
      }],
      required: true,
    }
    return { ...core, node_sha256: sha256(JSON.stringify(core)) }
  })
  const core = {
    schema_version: 1,
    artifact,
    assumptions,
    nodes,
    required_root_ids: ["obligation-0001"],
  }
  return { ...core, graph_sha256: sha256(JSON.stringify(core)) }
}

export function graphSourceContext() {
  const graph = mixedGraphFixture()
  return {
    graph,
    sources: {
      artifact: graph.artifact,
      artifact_content: ARTIFACT,
      objective_sha256: sha256(OBJECTIVE),
      objective_content: OBJECTIVE,
      references: [{
        source_id: "reference-01",
        source_sha256: sha256(REFERENCE),
        content: REFERENCE,
      }],
    },
  }
}
