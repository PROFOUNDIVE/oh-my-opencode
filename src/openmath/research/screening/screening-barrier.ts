import type { CampaignJobAttempt, CandidateDescriptor, ScreenReceipt } from "../state"

export function validateCompleteScreeningMatrix(input: Readonly<{
  readonly candidates: readonly CandidateDescriptor[]
  readonly role_ids: readonly string[]
  readonly jobs: readonly CampaignJobAttempt[]
  readonly receipts: readonly ScreenReceipt[]
}>): string | null {
  const expected = new Set(input.candidates.flatMap((candidate) => (
    input.role_ids.map((roleId) => `${candidate.candidate_id}\0${roleId}`)
  )))
  const actual = new Set<string>()
  const receipts = new Map(input.receipts.map((receipt) => [receipt.screen_id, receipt]))
  if (receipts.size !== input.receipts.length) return "Screen receipts must have unique IDs"
  for (const job of input.jobs) {
    if ((job.phase !== "COMPLETED" && job.phase !== "COMMITTED") || job.target.kind !== "SCREEN" || job.receipt.kind !== "SCREEN") {
      return "Every screen job must be terminal before the screening barrier"
    }
    if (job.receipt.normalized_output === undefined) return "Screen completion requires persisted normalized evidence"
    const receipt = receipts.get(job.target.screen_id)
    if (receipt === undefined || receipt.job_id !== job.job_id || receipt.candidate_id !== job.target.candidate_id) {
      return "Screen receipt must match its active job"
    }
    if (JSON.stringify(job.receipt.normalized_output) !== JSON.stringify(normalizedOutput(receipt))) {
      return "Screen receipt must match persisted normalized evidence"
    }
    actual.add(`${receipt.candidate_id}\0${receipt.screen_role}`)
  }
  if (actual.size !== expected.size || [...expected].some((key) => !actual.has(key))) {
    return "Initial-screen barrier requires every configured reviewer and candidate pair"
  }
  return null
}

function normalizedOutput(receipt: ScreenReceipt) {
  return {
    verdict: receipt.verdict,
    blocking_issues: receipt.blocking_issues,
    unresolved_obligations: receipt.unresolved_obligations,
    assumptions: receipt.assumptions,
    novel_elements: receipt.novel_elements,
  }
}
