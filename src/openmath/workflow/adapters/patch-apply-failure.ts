import { z } from "zod"

import type { OpenMathArtifactsPatchApplyErrorCode } from "../../artifacts-patch/apply"
import { OpenMathArtifactsSectionIdSchema } from "../../artifacts-patch/types"

const PatchApplyErrorCodeSchema = z.enum([
  "BASE_HASH_MISMATCH",
  "TOO_MANY_OPS",
  "UNKNOWN_SECTION",
  "DUPLICATE_SECTION_MARKER",
  "UNCLOSED_SECTION",
  "UNIQUE_SUBSTRING_DISABLED",
  "UNIQUE_SUBSTRING_TOO_SHORT",
  "UNIQUE_SUBSTRING_NOT_FOUND",
  "UNIQUE_SUBSTRING_NOT_UNIQUE",
  "PATCH_PARSE_ERROR",
  "ARTIFACTS_PARSE_ERROR",
  "DRAFT_VALIDATION_ERROR",
] satisfies readonly [OpenMathArtifactsPatchApplyErrorCode, ...OpenMathArtifactsPatchApplyErrorCode[]])

export const PatchApplyFailureSchema = z.object({
  error_code: PatchApplyErrorCodeSchema,
  section_id: OpenMathArtifactsSectionIdSchema.nullable(),
}).strict()

export type PatchApplyFailure = Readonly<z.infer<typeof PatchApplyFailureSchema>>
