import { z } from "zod"

const OpenMathArtifactsSectionIdSchema = z.enum([
  "reference_solution",
  "hint_ladder",
  "grading_rubric",
  "variant_problem",
])

export const ReplaceSectionOpSchema = z.object({
  op: z.literal("replace_section"),
  section_id: OpenMathArtifactsSectionIdSchema,
  new_content: z.string(),
})

export const ReplaceUniqueSubstringOpSchema = z.object({
  op: z.literal("replace_unique_substring"),
  section_id: OpenMathArtifactsSectionIdSchema,
  old: z.string().min(20),
  new: z.string(),
})

export const OpenMathArtifactsPatchOpSchema = z.discriminatedUnion("op", [
  ReplaceSectionOpSchema,
  ReplaceUniqueSubstringOpSchema,
])

export const OpenMathArtifactsPatchSetSchema = z.object({
  base_hash: z.string(),
  ops: z.array(OpenMathArtifactsPatchOpSchema),
})

export type ReplaceSectionOp = z.infer<typeof ReplaceSectionOpSchema>
export type ReplaceUniqueSubstringOp = z.infer<typeof ReplaceUniqueSubstringOpSchema>
export type OpenMathArtifactsPatchOp = z.infer<typeof OpenMathArtifactsPatchOpSchema>
export type OpenMathArtifactsPatchSet = z.infer<typeof OpenMathArtifactsPatchSetSchema>
