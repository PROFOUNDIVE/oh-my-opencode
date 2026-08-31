import { z } from "zod"

export const CertificationPhaseSchema = z.enum([
  "EXTRACTION",
  "COVERAGE_REVIEW",
  "COUNTEREXAMPLE_ATTACK",
  "WITNESS_VERIFICATION",
  "COMPLETE",
])

export const CertificationStatusSchema = z.enum([
  "READY",
  "RUNNING",
  "AWAITING_HUMAN",
  "BLOCKED",
  "COMPLETE",
  "ABORTED",
])

export const CertificationBlockedReasonSchema = z.enum([
  "ADAPTER_OUTPUT_INVALID",
  "DISPATCH_FAILED",
  "RECONCILIATION_AMBIGUOUS",
  "STORAGE_READ_FAILED",
  "STORAGE_WRITE_FAILED",
  "STALE_ARTIFACT",
  "STALE_GRAPH",
  "PROFILE_HASH_MISMATCH",
])

export const CertificationIdSchema = z.string()
  .regex(/^certification-[a-f0-9]{32}$/)
  .brand("ResearchCertificationId")
export const CertificationGenerationIdSchema = z.string().regex(/^[a-f0-9]{64}$/).brand("ResearchCertificationGenerationId")
export const CertificationSha256Schema = z.string().regex(/^[a-f0-9]{64}$/).brand("ResearchCertificationSha256")
export const CertificationRevisionSchema = z.number().int().nonnegative().max(999_999_999_999)
export const CertificationJobIdSchema = z.string().regex(/^cert-job-[a-z0-9]+(?:[._-][a-z0-9]+)*$/).max(160).brand("ResearchCertificationJobId")
export const ObligationIdSchema = z.string().regex(/^obligation-[0-9]{4}$/).brand("ResearchCertificationObligationId")
export const AssumptionIdSchema = z.string().regex(/^assumption-[0-9]{4}$/).brand("ResearchCertificationAssumptionId")
export const AttackAttemptIdSchema = z.string().regex(/^attack-[0-9]{4}$/).brand("ResearchCertificationAttackAttemptId")
export const WitnessVerificationIdSchema = z.string().regex(/^witness-[0-9]{4}$/).brand("ResearchCertificationWitnessVerificationId")
export const CoverageReviewIdSchema = z.string().regex(/^coverage-[0-9]{4}$/).brand("ResearchCertificationCoverageReviewId")
export const EvidenceReceiptIdSchema = z.string().regex(/^evidence-[0-9]{4}$/).brand("ResearchCertificationEvidenceReceiptId")
export const CertificationAmendmentIdSchema = z.string().regex(/^cert-amendment-[1-9][0-9]*$/).brand("ResearchCertificationAmendmentId")
export const CertificationSessionIdSchema = z.string().regex(/^ses_[A-Za-z0-9]+$/).brand("ResearchCertificationSessionId")
export const NonBlankSchema = z.string().refine((value) => value.trim().length > 0)

export type CertificationPhase = z.infer<typeof CertificationPhaseSchema>
export type CertificationStatus = z.infer<typeof CertificationStatusSchema>
