import { buildCoverageInput } from "../adapters/coverage-input"
import { buildExtractionInput } from "../adapters/extraction-input"
import type { CertificationAmendmentEvent } from "../state/amendments"
import type { ResearchCertificationStateV1 } from "../state/schema"
import { activeCertificationAmendments } from "../transitions"
import type { ExtractionCoverageRoundContext } from "./extraction-coverage-types"

type AddedAmendment = Extract<CertificationAmendmentEvent, { readonly event_type: "ADDED" }>

export type ExtractionRoundPayload = Readonly<{
  readonly extraction: ReturnType<typeof buildExtractionInput>
  readonly prior_graph: ResearchCertificationStateV1["graphs"][number] | null
  readonly prior_findings: ResearchCertificationStateV1["coverage_reviews"][number]["findings"]
  readonly amendments: readonly AddedAmendment[]
}>

export function buildExtractionRoundPayload(
  state: ResearchCertificationStateV1,
  context: ExtractionCoverageRoundContext,
): ExtractionRoundPayload {
  const priorCoverage = state.coverage_reviews.at(-1)
  return {
    extraction: buildExtractionInput(context.sources),
    prior_graph: state.graphs.at(-1) ?? null,
    prior_findings: priorCoverage?.findings ?? [],
    amendments: amendmentsForOperation(state, "graph"),
  }
}

export function buildCoverageRoundPayload(
  state: ResearchCertificationStateV1,
  context: ExtractionCoverageRoundContext,
) {
  const graph = state.graphs.at(-1)
  if (graph === undefined) throw new CertificationRoundPayloadError("STALE_GRAPH", "Coverage requires a committed canonical graph")
  return buildCoverageInput({ graph, sources: context.sources, max_findings: context.profile.max_coverage_findings })
}

export function amendmentsForOperation(
  state: ResearchCertificationStateV1,
  scope: "graph" | "coverage",
): readonly AddedAmendment[] {
  const active = activeCertificationAmendments(state).filter((amendment) => amendment.scope === scope)
  if (state.status !== "RUNNING") return active
  const revision = state.job_attempts.find((job) => state.active_job_ids.includes(job.job_id))?.prepared_at_revision
  if (revision === undefined) return []
  const consumedIds = new Set(state.amendments
    .filter((event) => event.event_type === "CONSUMED" && event.certification_revision === revision)
    .map((event) => event.amendment_id))
  return state.amendments.filter((event): event is AddedAmendment =>
    event.event_type === "ADDED" && event.scope === scope && consumedIds.has(event.amendment_id))
}

export class CertificationRoundPayloadError extends Error {
  readonly name = "CertificationRoundPayloadError"

  constructor(readonly code: "STALE_GRAPH" | "STALE_ARTIFACT", message: string) {
    super(message)
  }
}
