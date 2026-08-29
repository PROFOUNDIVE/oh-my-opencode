import { createHash } from "node:crypto"
import { z } from "zod"

import { ReferenceSnapshotSchema, WorkflowProfileSnapshotSchema, type WorkflowRequestSnapshot } from "../../workflow/state"
import {
  CampaignHashSchema,
  NonBlankSchema,
  ResolvedResearchModelSchema,
  type ResearchCampaignStateV1,
} from "../state"

const ResolvedResearchPromptSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("inline"), content: z.string(), content_hash: CampaignHashSchema }).strict(),
  z.object({
    kind: z.literal("file"),
    original_uri: NonBlankSchema,
    base_dir: NonBlankSchema,
    resolved_path: NonBlankSchema,
    canonical_path: NonBlankSchema,
    content: z.string(),
    content_hash: CampaignHashSchema,
  }).strict(),
]).readonly()

const ResolvedResearchRoleSchema = z.object({
  agent: NonBlankSchema,
  model: ResolvedResearchModelSchema,
  prompt: ResolvedResearchPromptSchema,
}).strict().readonly()

const FrozenResearchProfileSchema = z.object({
  snapshot_version: z.literal(1),
  name: NonBlankSchema,
  candidate_workflow_profile: WorkflowProfileSnapshotSchema,
  candidate_workflow_profile_hash: CampaignHashSchema,
  strategies: z.array(z.object({
    id: z.string().regex(/^[a-z][a-z0-9-]*$/),
    prompt: ResolvedResearchPromptSchema,
  }).strict().readonly()).min(2).max(8).readonly(),
  candidates_per_strategy: z.number().int().min(1).max(4),
  screening_roles: z.array(z.object({
    id: z.string().regex(/^[a-z][a-z0-9-]*$/),
    agent: NonBlankSchema,
    model: ResolvedResearchModelSchema,
    prompt: ResolvedResearchPromptSchema,
  }).strict().readonly()).min(1).max(4).readonly(),
  max_active_candidates: z.number().int().min(1).max(32),
  survivor_limit: z.number().int().min(1).max(32),
  tournament_role: ResolvedResearchRoleSchema,
  profile_hash: CampaignHashSchema,
  reference_snapshot: ReferenceSnapshotSchema,
}).strict().readonly()

export type FrozenCandidateSources = Readonly<{
  readonly objective: WorkflowRequestSnapshot
  readonly profile: z.infer<typeof FrozenResearchProfileSchema>
  readonly references: z.infer<typeof ReferenceSnapshotSchema>
}>

export type FrozenCandidateSourcesResult =
  | { readonly ok: true; readonly sources: FrozenCandidateSources }
  | { readonly ok: false; readonly message: string }

export function parseFrozenCandidateSources(state: ResearchCampaignStateV1): FrozenCandidateSourcesResult {
  if (sha256(JSON.stringify(state.source_snapshot.objective.request)) !== state.source_snapshot.objective.sha256
    || sha256(state.source_snapshot.profile.serialized_bytes) !== state.source_snapshot.profile.sha256
    || sha256(state.source_snapshot.references.serialized_bytes) !== state.source_snapshot.references.sha256) {
    return { ok: false, message: "Frozen candidate source hash does not match its serialized bytes" }
  }
  const profile = parseJson(FrozenResearchProfileSchema, state.source_snapshot.profile.serialized_bytes)
  const references = parseJson(ReferenceSnapshotSchema, state.source_snapshot.references.serialized_bytes)
  if (!profile.success || !references.success) {
    return { ok: false, message: "Frozen candidate sources are invalid" }
  }
  return {
    ok: true,
    sources: {
      objective: state.source_snapshot.objective.request,
      profile: profile.data,
      references: references.data,
    },
  }
}

function parseJson<T>(schema: z.ZodType<T>, bytes: string): z.ZodSafeParseResult<T> {
  try {
    return schema.safeParse(JSON.parse(bytes))
  } catch (error) {
    if (error instanceof SyntaxError) return schema.safeParse(undefined)
    throw error
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex")
}
