import { createHash } from "node:crypto"
import { z } from "zod"

import { ReferenceSnapshotSchema, WorkflowProfileSnapshotSchema, type WorkflowRequestSnapshot } from "../../workflow/state"
import { addCertificationAttackBoundIssues, ResearchCertificationAttackModeSchema } from "../profile-schema"
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

const FrozenCertificationProfileSchema = z.object({
  schema_version: z.literal(1),
  extraction_role: ResolvedResearchRoleSchema,
  coverage_role: ResolvedResearchRoleSchema,
  counterexample_role: ResolvedResearchRoleSchema,
  witness_role: ResolvedResearchRoleSchema,
  max_obligations: z.number().int().min(1).max(256),
  max_coverage_rounds: z.number().int().min(1).max(5),
  max_coverage_findings: z.number().int().min(1).max(256),
  allowed_attack_modes: z.array(ResearchCertificationAttackModeSchema).min(1).max(7).readonly(),
  max_attacks_per_obligation: z.number().int().min(1).max(7),
  max_active_certification_jobs: z.number().int().min(1).max(16),
  certification_profile_hash: CampaignHashSchema,
}).strict().superRefine((certification, context) => {
  addCertificationAttackBoundIssues(certification, context)
}).readonly()

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
  certification: FrozenCertificationProfileSchema.optional(),
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
  const { profile_hash: profileHash, reference_snapshot: _referenceSnapshot, ...profileCore } = profile.data
  if (sha256(JSON.stringify(profileCore)) !== profileHash) {
    return { ok: false, message: "Frozen candidate profile hash does not match its contents" }
  }
  if (profile.data.certification !== undefined) {
    const { certification_profile_hash: certificationHash, ...certificationCore } = profile.data.certification
    if (sha256(JSON.stringify(certificationCore)) !== certificationHash) {
      return { ok: false, message: "Frozen certification profile hash does not match its contents" }
    }
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
