import type { OpaqueAttachmentReference } from "../state/attachments"
import type { CandidateDescriptor } from "../state/candidates"
import type { ResearchCampaignStateV1 } from "../state/schema"

export function selectPromotionLineage(
  candidates: readonly CandidateDescriptor[],
  selected: CandidateDescriptor,
): readonly CandidateDescriptor[] | null {
  const required = new Set<string>([selected.candidate_id])
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const candidate = candidates[index]
    if (candidate !== undefined && required.has(candidate.candidate_id)) {
      for (const parent of candidate.parent_candidate_ids) required.add(parent)
    }
  }
  const lineage = candidates.filter((candidate) => required.has(candidate.candidate_id))
  return lineage.length === required.size ? lineage : null
}

export function promotionLineageEntry(candidate: CandidateDescriptor) {
  const common = {
    candidate_id: candidate.candidate_id,
    created_at_revision: candidate.created_at_revision,
    child_run_id: candidate.child_run_id,
    parent_candidate_ids: candidate.parent_candidate_ids,
  }
  switch (candidate.candidate_kind) {
    case "STRATEGY":
      return { ...common, candidate_kind: candidate.candidate_kind, strategy_id: candidate.strategy_id, strategy_ordinal: candidate.strategy_ordinal }
    case "MERGE_IDEA":
      return { ...common, candidate_kind: candidate.candidate_kind, synthesis_brief: candidate.synthesis_brief, synthesis_brief_sha256: candidate.synthesis_brief_sha256 }
    default:
      return assertNever(candidate)
  }
}

export function collectPromotionAttachments(
  campaignAttachments: readonly OpaqueAttachmentReference[],
  lineage: readonly CandidateDescriptor[],
  screens: ResearchCampaignStateV1["screen_receipts"],
): readonly OpaqueAttachmentReference[] {
  const values = [
    ...campaignAttachments,
    ...lineage.flatMap((candidate) => candidate.attachments),
    ...screens.flatMap((screen) => screen.attachments),
  ]
  return values.filter((attachment, index) => (
    values.findIndex((value) => value.attachment_id === attachment.attachment_id) === index
  ))
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected dossier lineage candidate: ${String(value)}`)
}
