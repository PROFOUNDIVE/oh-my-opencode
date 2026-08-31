import { z } from "zod"
import { createHash } from "node:crypto"

const NonBlankSchema = z.string().refine((value) => value.trim().length > 0)
const HashSchema = z.string().regex(/^[a-f0-9]{64}$/)

export const WorkflowRequestSnapshotSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("problem"),
    source: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("text"), text: NonBlankSchema }).strict(),
      z.object({
        kind: z.literal("file"),
        file_path: NonBlankSchema,
        problem_number: z.number().int().positive(),
        resolved_path: NonBlankSchema,
      }).strict(),
    ]),
    problem_text: NonBlankSchema,
    subject: z.string().optional(),
    chapter_context: z.string().optional(),
    textbook_markdown: z.string().optional(),
    supplementary_refs: z.array(z.string()).optional(),
  }).strict(),
  z.object({
    kind: z.literal("markdown"),
    instruction: NonBlankSchema,
  }).strict(),
  z.object({
    kind: z.literal("research_educationalization"),
    campaign_id: NonBlankSchema,
    approved_campaign_revision: z.number().int().nonnegative(),
    dossier_id: NonBlankSchema,
    dossier_sha256: HashSchema,
    selected_artifact: z.object({
      candidate_id: NonBlankSchema,
      child_run_id: NonBlankSchema,
      child_state_revision: z.number().int().nonnegative(),
      artifact_version: z.number().int().positive(),
      media_type: z.enum(["text/markdown", "application/vnd.openmath.legacy+json"]),
      artifact_sha256: HashSchema,
    }).strict(),
    certification: z.object({
      certification_id: NonBlankSchema,
      generation_id: HashSchema,
      certification_revision: z.number().int().nonnegative(),
      content_sha256: HashSchema,
      summary_sha256: HashSchema,
    }).strict(),
    certification_summary_json: NonBlankSchema,
    remaining_uncertainties_json: NonBlankSchema,
    remaining_uncertainties_sha256: HashSchema,
    reference_solution: NonBlankSchema,
    reference_solution_sha256: HashSchema,
    original_problem_text: NonBlankSchema.optional(),
  }).strict().superRefine((request, context) => {
    if (sha256(request.reference_solution) !== request.reference_solution_sha256) {
      context.addIssue({ code: "custom", path: ["reference_solution_sha256"], message: "Reference solution hash mismatch" })
    }
    if (sha256(request.certification_summary_json) !== request.certification.summary_sha256) {
      context.addIssue({ code: "custom", path: ["certification", "summary_sha256"], message: "Certification summary hash mismatch" })
    }
    if (sha256(request.remaining_uncertainties_json) !== request.remaining_uncertainties_sha256) {
      context.addIssue({ code: "custom", path: ["remaining_uncertainties_sha256"], message: "Remaining uncertainties hash mismatch" })
    }
  }),
])

export type WorkflowRequestSnapshot = z.infer<typeof WorkflowRequestSnapshotSchema>

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex")
}
