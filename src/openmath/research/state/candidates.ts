import { z } from "zod"

import { sha256 } from "../../workflow/stage-runner/sha256"
import { OpaqueAttachmentReferencesSchema } from "./attachments"
import {
  CampaignHashSchema,
  CampaignRevisionSchema,
  CandidateIdSchema,
  ChildRunIdSchema,
  NonBlankSchema,
} from "./literals"

export const CandidateArtifactReferenceSchema = z.object({
  child_run_id: ChildRunIdSchema,
  child_state_revision: CampaignRevisionSchema,
  artifact_version: z.number().int().positive(),
  media_type: z.enum(["text/markdown", "application/vnd.openmath.legacy+json"]),
  sha256: CampaignHashSchema,
}).strict().readonly()

const CandidateBaseSchema = z.object({
  candidate_id: CandidateIdSchema,
  created_at_revision: CampaignRevisionSchema,
  child_run_id: ChildRunIdSchema,
  child_state_revision: CampaignRevisionSchema.nullable(),
  artifact: CandidateArtifactReferenceSchema.nullable(),
  attachments: OpaqueAttachmentReferencesSchema,
})

const ParentCandidateIdsSchema = z.array(CandidateIdSchema)
  .min(2)
  .superRefine((parents, context) => {
    if (new Set(parents).size !== parents.length) {
      context.addIssue({ code: "custom", message: "Merge candidate parents must be unique" })
    }
  })
  .readonly()

export const CandidateDescriptorSchema = z.discriminatedUnion("candidate_kind", [
  CandidateBaseSchema.extend({
    candidate_kind: z.literal("STRATEGY"),
    strategy_id: z.string().regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/).max(128),
    strategy_ordinal: z.number().int().positive(),
    parent_candidate_ids: z.array(CandidateIdSchema).length(0).default([]).readonly(),
  }).strict(),
  CandidateBaseSchema.extend({
    candidate_kind: z.literal("MERGE_IDEA"),
    parent_candidate_ids: ParentCandidateIdsSchema,
    synthesis_brief: NonBlankSchema,
    synthesis_brief_sha256: CampaignHashSchema,
  }).strict(),
]).superRefine((candidate, context) => {
  if (candidate.artifact !== null) {
    if (candidate.artifact.child_run_id !== candidate.child_run_id) {
      context.addIssue({ code: "custom", path: ["artifact", "child_run_id"], message: "Artifact child run must match candidate child run" })
    }
    if (candidate.artifact.child_state_revision !== candidate.child_state_revision) {
      context.addIssue({ code: "custom", path: ["artifact", "child_state_revision"], message: "Artifact child revision must match candidate child revision" })
    }
  }
  switch (candidate.candidate_kind) {
    case "STRATEGY":
      return
    case "MERGE_IDEA":
      if (sha256(candidate.synthesis_brief) !== candidate.synthesis_brief_sha256) {
        context.addIssue({ code: "custom", path: ["synthesis_brief_sha256"], message: "Synthesis brief hash must match the exact brief" })
      }
      return
    default:
      assertNever(candidate)
  }
}).readonly()

function assertNever(value: never): never {
  throw new TypeError(`Unexpected candidate kind: ${String(value)}`)
}

export type CandidateArtifactReference = z.infer<typeof CandidateArtifactReferenceSchema>
export type CandidateDescriptor = z.infer<typeof CandidateDescriptorSchema>
