import type { CandidateDescriptor, CandidateId, ScreenReceipt, ScreenVerdict } from "../state"

const VERDICT_PRECEDENCE: Readonly<Record<ScreenVerdict, number>> = {
  VIABLE: 0,
  INCONCLUSIVE: 1,
  REPAIRABLE: 2,
  FATAL_FLAW: 3,
}

export type CandidateScreeningResult = Readonly<{
  readonly candidate_id: CandidateId
  readonly verdict: ScreenVerdict
}>

export function aggregateScreening(
  candidates: readonly CandidateDescriptor[],
  receipts: readonly ScreenReceipt[],
  survivorLimit: number,
): Readonly<{
  readonly results: readonly CandidateScreeningResult[]
  readonly survivor_ids: readonly CandidateId[]
  readonly all_inconclusive: boolean
}> {
  const byCandidate = Map.groupBy(receipts, (receipt) => receipt.candidate_id)
  const results = candidates.map((candidate) => ({
    candidate_id: candidate.candidate_id,
    verdict: aggregateVerdict(byCandidate.get(candidate.candidate_id) ?? []),
  }))
  const survivorIds = results
    .filter((result) => result.verdict === "VIABLE" || result.verdict === "REPAIRABLE")
    .sort((left, right) => survivorRank(left.verdict) - survivorRank(right.verdict))
    .slice(0, survivorLimit)
    .map((result) => result.candidate_id)
  return {
    results,
    survivor_ids: survivorIds,
    all_inconclusive: results.length > 0 && results.every((result) => result.verdict === "INCONCLUSIVE"),
  }
}

function aggregateVerdict(receipts: readonly ScreenReceipt[]): ScreenVerdict {
  return receipts.reduce<ScreenVerdict>((verdict, receipt) => (
    VERDICT_PRECEDENCE[receipt.verdict] > VERDICT_PRECEDENCE[verdict] ? receipt.verdict : verdict
  ), "VIABLE")
}

function survivorRank(verdict: ScreenVerdict): number {
  return verdict === "VIABLE" ? 0 : 1
}
