import { sha256 } from "../../../workflow/stage-runner/sha256"

const ARTIFACT_CONTENT = "Root theorem\nImported lemma\nOptional note"
const OBJECTIVE_CONTENT = "Prove the root theorem."
const REFERENCE_CONTENT = "Imported lemma is established."

export function extractionSources() {
  return {
    artifact: {
      candidate_id: "candidate-01",
      child_run_id: "campaign-a::candidate-01",
      child_state_revision: 7,
      artifact_version: 2,
      media_type: "text/markdown" as const,
      artifact_sha256: sha256(ARTIFACT_CONTENT),
    },
    artifact_content: ARTIFACT_CONTENT,
    objective_sha256: sha256(OBJECTIVE_CONTENT),
    objective_content: OBJECTIVE_CONTENT,
    references: [{
      source_id: "reference-01",
      source_sha256: sha256(REFERENCE_CONTENT),
      content: REFERENCE_CONTENT,
    }],
  }
}

export function extractionOutput() {
  return {
    assumptions: [{
      local_id: "reference-assumption",
      statement: " \tImported\r\nlemma is available. \n",
      source_kind: "REFERENCE",
      source_id: "reference-01",
      source_span: null,
    }],
    nodes: [{
      local_id: "imported",
      kind: "IMPORTED_RESULT",
      source_span: sourceSpan(ARTIFACT_CONTENT, "Imported lemma"),
      statement: " \tImported lemma \n",
      prerequisite_local_ids: [],
      assumption_local_ids: ["reference-assumption"],
      required: true,
    }, {
      local_id: "root",
      kind: "THEOREM",
      source_span: sourceSpan(ARTIFACT_CONTENT, "Root theorem"),
      statement: " \tRoot theorem \n",
      prerequisite_local_ids: ["imported"],
      assumption_local_ids: [],
      required: true,
    }],
    required_root_local_ids: ["root"],
  }
}

export function sourceSpan(content: string, exact: string) {
  const startByte = Buffer.byteLength(content.slice(0, content.indexOf(exact)), "utf8")
  return {
    start_byte: startByte,
    end_byte: startByte + Buffer.byteLength(exact, "utf8"),
    span_sha256: sha256(exact),
  }
}

export const EXTRACTION_ARTIFACT_CONTENT = ARTIFACT_CONTENT
