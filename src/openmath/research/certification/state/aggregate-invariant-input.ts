import type { CertificationAmendmentEvent } from "./amendments"
import type { AttackAttempt } from "./attacks"
import type { CoverageReview } from "./coverage"
import type { EvidenceReceiptV1 } from "./evidence"
import type { CertificationFinalization } from "./finalization"
import type { CertificationGraph } from "./graph"
import type { CertificationSelectedArtifact } from "./identity"
import type { CertificationJobAttempt } from "./jobs"
import type { CertificationSummaryV1 } from "./summary"
import type { WitnessVerification } from "./witnesses"

export type CertificationAggregateInvariantInput = {
  readonly certification_id: string
  readonly generation_id: string
  readonly campaign_id: string
  readonly selected_artifact: CertificationSelectedArtifact
  readonly objective_sha256: string
  readonly profile_sha256: string
  readonly reference_sha256: string
  readonly certification_profile_sha256: string
  readonly certification_revision: number
  readonly phase: string
  readonly status: string
  readonly active_job_ids: readonly string[]
  readonly graphs: readonly CertificationGraph[]
  readonly coverage_reviews: readonly CoverageReview[]
  readonly attack_attempts: readonly AttackAttempt[]
  readonly witness_verifications: readonly WitnessVerification[]
  readonly evidence_receipts: readonly EvidenceReceiptV1[]
  readonly amendments: readonly CertificationAmendmentEvent[]
  readonly job_attempts: readonly CertificationJobAttempt[]
  readonly summary: CertificationSummaryV1 | null
  readonly finalization: CertificationFinalization | null
}
