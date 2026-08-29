import type { z } from "zod"

import type { AggregateInvariantInput } from "./aggregate-invariant-input"

export function validateCampaignHashInvariants(state: AggregateInvariantInput, context: z.RefinementCtx): void {
  const candidates = new Map(state.candidates.map((candidate) => [candidate.candidate_id, candidate]))
  const jobs = new Map(state.job_attempts.map((job) => [job.job_id, job]))
  for (const [index, job] of state.job_attempts.entries()) {
    if (job.profile_sha256 !== state.source_snapshot.profile.sha256) addIssue(context, ["job_attempts", index, "profile_sha256"], "Job profile hash must match snapshot")
    if (job.reference_sha256 !== state.source_snapshot.references.sha256) addIssue(context, ["job_attempts", index, "reference_sha256"], "Job reference hash must match snapshot")
    switch (job.phase) {
      case "PREPARED":
      case "SESSION_CREATED":
      case "PROMPT_SENT":
      case "COMPLETED":
        break
      case "COMMITTED":
        validateCommittedReceipt(job.receipt, candidates, context, index)
        break
      default:
        assertNever(job)
    }
  }
  for (const [index, screen] of state.screen_receipts.entries()) {
    const job = jobs.get(screen.job_id)
    if (screen.profile_sha256 !== state.source_snapshot.profile.sha256 || screen.reference_sha256 !== state.source_snapshot.references.sha256) addIssue(context, ["screen_receipts", index], "Screen hashes must match snapshots")
    if (job === undefined || !sameProvenance(job, screen)) addIssue(context, ["screen_receipts", index], "Screen provenance must match its job")
  }
  for (const [index, tournament] of state.tournament_receipts.entries()) {
    const job = jobs.get(tournament.job_id)
    if (tournament.profile_sha256 !== state.source_snapshot.profile.sha256 || tournament.reference_sha256 !== state.source_snapshot.references.sha256) addIssue(context, ["tournament_receipts", index], "Tournament hashes must match snapshots")
    if (job === undefined || !sameProvenance(job, tournament)) addIssue(context, ["tournament_receipts", index], "Tournament provenance must match its job")
  }
}

function validateCommittedReceipt(
  receipt: Extract<AggregateInvariantInput["job_attempts"][number], { readonly phase: "COMMITTED" }>["receipt"],
  candidates: ReadonlyMap<string, AggregateInvariantInput["candidates"][number]>,
  context: z.RefinementCtx,
  index: number,
): void {
  switch (receipt.kind) {
    case "ERROR":
    case "SCREEN":
    case "TOURNAMENT":
      return
    case "CANDIDATE_ARTIFACT": {
      const artifact = candidates.get(receipt.candidate_id)?.artifact
      if (artifact === null || artifact === undefined || artifact.sha256 !== receipt.artifact_sha256) addIssue(context, ["job_attempts", index, "receipt", "artifact_sha256"], "Candidate receipt hash must match artifact")
      return
    }
    default:
      assertNever(receipt)
  }
}

function sameProvenance(
  job: AggregateInvariantInput["job_attempts"][number],
  receipt: AggregateInvariantInput["screen_receipts"][number] | AggregateInvariantInput["tournament_receipts"][number],
): boolean {
  switch (job.phase) {
    case "PREPARED":
    case "SESSION_CREATED":
    case "PROMPT_SENT":
      return false
    case "COMPLETED":
    case "COMMITTED":
      return job.child_session_id === receipt.reviewer_session_id
        && job.profile_sha256 === receipt.profile_sha256
        && job.prompt_sha256 === receipt.prompt_sha256
        && job.reference_sha256 === receipt.reference_sha256
        && job.raw_output_sha256 === receipt.raw_output_sha256
        && job.resolved_model.providerID === receipt.resolved_model.providerID
        && job.resolved_model.modelID === receipt.resolved_model.modelID
        && job.resolved_model.variant === receipt.resolved_model.variant
    default:
      return assertNever(job)
  }
}

function addIssue(context: z.RefinementCtx, path: readonly (string | number)[], message: string): void {
  context.addIssue({ code: "custom", path: [...path], message })
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected campaign hash variant: ${String(value)}`)
}
