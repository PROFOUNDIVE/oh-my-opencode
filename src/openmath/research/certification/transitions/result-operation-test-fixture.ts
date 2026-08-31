import { ResearchCertificationStateV1Schema } from "../state/schema"
import { operationRecords } from "./operation-test-fixture"
import { completeTransitionState } from "./transition-test-fixture"

export function certificationResultOperationFixture() {
  const final = completeTransitionState("REJECTED")
  const attackJobs = final.job_attempts.filter((job) => job.job_kind === "ATTACK")
  const attackOperations = attackJobs.map((job) => {
    const evidence = final.evidence_receipts.find((receipt) => receipt.job_id === job.job_id)
    if (evidence === undefined) throw new TypeError("Missing attack evidence")
    return operationRecords(job, evidence, 3, 4)
  })
  const witnessJob = final.job_attempts.find((job) => job.job_kind === "WITNESS")
  const witnessEvidence = final.evidence_receipts.find((receipt) => receipt.job_kind === "WITNESS")
  if (witnessJob === undefined || witnessEvidence === undefined) throw new TypeError("Missing witness operation")
  const witnessOperation = operationRecords(witnessJob, witnessEvidence, 5, 6)
  const readyAttack = ResearchCertificationStateV1Schema.parse({
    ...final,
    certification_revision: 2,
    phase: "COUNTEREXAMPLE_ATTACK",
    status: "READY",
    attack_attempts: [],
    witness_verifications: [],
    evidence_receipts: final.evidence_receipts.slice(0, 2),
    job_attempts: final.job_attempts.slice(0, 2),
    summary: null,
    finalization: null,
  })
  return {
    ready_attack: readyAttack,
    attacks: {
      prepared: attackOperations.map((operation) => operation.prepared),
      completed: attackOperations.map((operation) => operation.completed),
      records: final.attack_attempts.map((attack) => ({ ...attack, certification_revision: 4 })),
      evidence: attackOperations.map((operation) => operation.evidence),
    },
    witness: {
      prepared: witnessOperation.prepared,
      completed: witnessOperation.completed,
      record: { ...final.witness_verifications[0], certification_revision: 6 },
      evidence: witnessOperation.evidence,
    },
  }
}
