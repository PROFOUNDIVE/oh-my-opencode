import { z } from "zod"

import { isWorkflowAdapterAllowed, WorkflowAdapterNameSchema } from "../adapters"
import { WorkflowCheckpointPolicySchema } from "../checkpoint-policy"
import { WorkflowProfileNameSchema } from "../profile-schema"
import { HashSchema } from "./literals"

const NonBlankSchema = z.string().refine((value) => value.trim().length > 0)
const ModelSegmentSchema = z.string().regex(/^\S+$/)

const ResolvedPromptSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("builtin") }).strict(),
  z.object({ kind: z.literal("inline"), content: NonBlankSchema }).strict(),
  z.object({
    kind: z.literal("file"),
    original_uri: z.string().startsWith("file://"),
    base_dir: NonBlankSchema,
    resolved_path: NonBlankSchema,
    canonical_path: NonBlankSchema,
    content: NonBlankSchema,
    content_hash: HashSchema,
  }).strict(),
])

const ResolvedWorkflowRoleSnapshotSchema = z.object({
  agent: NonBlankSchema,
  model: z.object({
    providerID: ModelSegmentSchema,
    modelID: ModelSegmentSchema,
    variant: NonBlankSchema.optional(),
  }).strict(),
  prompt: ResolvedPromptSourceSchema,
  output_adapter: WorkflowAdapterNameSchema,
}).strict()

export const WorkflowProfileSnapshotSchema = z.object({
  name: WorkflowProfileNameSchema,
  solve: ResolvedWorkflowRoleSnapshotSchema,
  review: ResolvedWorkflowRoleSnapshotSchema,
  revise: ResolvedWorkflowRoleSnapshotSchema,
  min_review_rounds: z.number().int().positive(),
  max_review_rounds: z.number().int().positive(),
  required_consecutive_passes: z.number().int().positive(),
  checkpoint: WorkflowCheckpointPolicySchema,
}).strict().superRefine((value, context) => {
  if (value.min_review_rounds > value.max_review_rounds) context.addIssue({ code: z.ZodIssueCode.custom, path: ["min_review_rounds"], message: "min_review_rounds must not exceed max_review_rounds" })
  if (value.required_consecutive_passes > value.max_review_rounds) context.addIssue({ code: z.ZodIssueCode.custom, path: ["required_consecutive_passes"], message: "required_consecutive_passes must not exceed max_review_rounds" })
  for (const stage of ["solve", "review", "revise"] as const) {
    if (!isWorkflowAdapterAllowed(stage, value[stage].output_adapter)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: [stage, "output_adapter"], message: `Invalid ${stage} adapter` })
    }
  }
})

const ReferenceSourceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("file"),
    declaredPath: NonBlankSchema,
    resolvedPath: NonBlankSchema,
    canonicalPath: NonBlankSchema,
    manifestCanonicalPath: NonBlankSchema,
  }).strict(),
  z.object({ kind: z.literal("inline"), path: NonBlankSchema }).strict(),
])

export const ReferenceSnapshotSchema = z.object({
  version: z.literal(1),
  manifest: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("file"),
      originalPath: NonBlankSchema,
      resolvedPath: NonBlankSchema,
      canonicalPath: NonBlankSchema,
    }).strict(),
    z.object({ kind: z.literal("legacy_supplementary") }).strict(),
  ]),
  references: z.array(z.object({
    id: z.string().trim().min(1),
    role: z.enum(["authoritative", "accepted_prior", "background", "candidate", "empirical_evidence"]),
    stages: z.array(z.enum(["solve", "review", "revise"])).min(1),
    required: z.boolean(),
    content: z.string(),
    sha256: HashSchema,
    source: ReferenceSourceSchema,
  }).strict()).superRefine((references, context) => {
    const ids = new Set<string>()
    for (const [index, reference] of references.entries()) {
      if (ids.has(reference.id)) context.addIssue({ code: z.ZodIssueCode.custom, path: [index, "id"], message: "Reference IDs must be unique" })
      ids.add(reference.id)
      if (new Set(reference.stages).size !== reference.stages.length) context.addIssue({ code: z.ZodIssueCode.custom, path: [index, "stages"], message: "Reference stages must not repeat" })
    }
  }),
  diagnostics: z.array(z.object({
    code: z.literal("optional_missing"),
    id: z.string().trim().min(1),
    path: NonBlankSchema,
  }).strict()),
  sha256: HashSchema,
}).strict()
