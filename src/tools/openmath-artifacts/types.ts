import { z } from "zod"

import { OpenMathArtifactsPatchSetSchema } from "../../openmath/artifacts-patch/types"

export const OpenMathArtifactsDraftSchema = z.object({
  reference_solution: z.string(),
  hint_ladder: z.record(z.string(), z.unknown()),
  grading_rubric: z.record(z.string(), z.unknown()),
  variant_problem: z.string(),
})

export const OpenMathArtifactsParseInputSchema = z.object({
  markdown: z.string(),
})

export const OpenMathArtifactsParseSuccessSchema = z.object({
  normalized_markdown: z.string(),
  base_hash: z.string(),
  draft: OpenMathArtifactsDraftSchema,
})

export const OpenMathArtifactsApplyPatchInputSchema = z.object({
  base_markdown: z.string(),
  patch_set: OpenMathArtifactsPatchSetSchema,
})

export const OpenMathArtifactsApplyPatchSuccessSchema = z.object({
  markdown: z.string(),
  hash: z.string(),
  draft: OpenMathArtifactsDraftSchema,
})

export type OpenMathArtifactsParseInput = z.infer<typeof OpenMathArtifactsParseInputSchema>
export type OpenMathArtifactsApplyPatchInput = z.infer<typeof OpenMathArtifactsApplyPatchInputSchema>
