import { z } from "zod"

import { WorkflowRequestSnapshotSchema } from "../../workflow/state/request-snapshot"
import { CampaignHashSchema, NonBlankSchema } from "./literals"

const FrozenSerializedSnapshotSchema = z.object({
  schema_version: z.number().int().positive(),
  serialized_bytes: NonBlankSchema,
  sha256: CampaignHashSchema,
}).strict()

export const ResearchCampaignSourceSnapshotSchema = z.object({
  objective: z.object({
    request: WorkflowRequestSnapshotSchema.readonly(),
    sha256: CampaignHashSchema,
  }).strict().readonly(),
  profile: FrozenSerializedSnapshotSchema.extend({
    name: z.string().regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/).max(128),
  }).strict().readonly(),
  references: FrozenSerializedSnapshotSchema.strict().readonly(),
}).strict().readonly()

export type ResearchCampaignSourceSnapshot = z.infer<typeof ResearchCampaignSourceSnapshotSchema>
