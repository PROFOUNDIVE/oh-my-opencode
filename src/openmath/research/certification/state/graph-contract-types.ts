import type { CertificationAssumption, CertificationAssumptionBinding } from "./assumptions"
import type { CertificationSelectedArtifact } from "./identity"
import type { CertificationSourceSpan } from "./source-span"

export type CertificationObligationNodeContract = Readonly<{
  readonly obligation_id: string
  readonly kind: "THEOREM" | "LEMMA" | "CLAIM" | "DEFINITION" | "IMPORTED_RESULT" | "COMPUTATION"
  readonly source_span: CertificationSourceSpan
  readonly statement: string
  readonly prerequisite_ids: readonly string[]
  readonly assumption_bindings: readonly CertificationAssumptionBinding[]
  readonly required: boolean
  readonly node_sha256: string
}>

export type CertificationGraphContract = Readonly<{
  readonly schema_version: 1
  readonly artifact: CertificationSelectedArtifact
  readonly assumptions: readonly CertificationAssumption[]
  readonly nodes: readonly CertificationObligationNodeContract[]
  readonly required_root_ids: readonly string[]
  readonly graph_sha256: string
}>
