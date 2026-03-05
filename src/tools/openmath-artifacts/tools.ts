import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool"

import { hashOpenMathArtifactsMarkdown } from "../../openmath/artifacts-markdown/hash"
import { parseOpenMathArtifactsMarkdown } from "../../openmath/artifacts-markdown/parse"
import { applyOpenMathArtifactsPatch } from "../../openmath/artifacts-patch/apply"
import {
  OpenMathArtifactsApplyPatchInputSchema,
  OpenMathArtifactsParseInputSchema,
} from "./types"

type OpenMathArtifactsToolDefaults = {
  max_ops?: number
  allow_unique_substring_replace?: boolean
}

export function createOpenMathArtifactsTools(
  defaults?: OpenMathArtifactsToolDefaults,
): Record<string, ToolDefinition> {
  const openmath_artifacts_parse: ToolDefinition = tool({
    description: "Parse OpenMath artifacts markdown, returning normalized markdown + base hash + derived draft.",
    args: {
      markdown: tool.schema.string().describe("OpenMath artifacts markdown"),
    },
    execute: async (args: Record<string, unknown>) => {
      try {
        const validatedArgs = OpenMathArtifactsParseInputSchema.parse(args)
        const parsed = parseOpenMathArtifactsMarkdown(validatedArgs.markdown)
        const base_hash = hashOpenMathArtifactsMarkdown(parsed.normalizedMarkdown)

        if (!parsed.ok) {
          return JSON.stringify({
            error_code: "ARTIFACTS_PARSE_ERROR",
            normalized_markdown: parsed.normalizedMarkdown,
            base_hash,
            details: parsed.error,
          })
        }

        return JSON.stringify({
          normalized_markdown: parsed.normalizedMarkdown,
          base_hash,
          draft: parsed.draft,
        })
      } catch (error) {
        if (error instanceof Error) {
          return JSON.stringify({ error_code: "VALIDATION_ERROR", message: error.message })
        }
        return JSON.stringify({ error_code: "UNKNOWN_ERROR" })
      }
    },
  })

  const openmath_artifacts_apply_patch: ToolDefinition = tool({
    description:
      "Apply a deterministic, base-hash-guarded patch set to OpenMath artifacts markdown and re-derive structured draft.",
    args: {
      base_markdown: tool.schema.string().describe("Base OpenMath artifacts markdown"),
      patch_set: tool.schema
        .record(tool.schema.string(), tool.schema.unknown())
        .describe("PatchSet payload with base_hash and ops"),
    },
    execute: async (args: Record<string, unknown>) => {
      try {
        const validatedArgs = OpenMathArtifactsApplyPatchInputSchema.parse(args)

        const result = applyOpenMathArtifactsPatch({
          base_markdown: validatedArgs.base_markdown,
          patch_set: validatedArgs.patch_set,
          opts: {
            max_ops: defaults?.max_ops,
            allow_unique_substring_replace: defaults?.allow_unique_substring_replace,
          },
        })

        if (!result.ok) {
          return JSON.stringify({ error_code: result.error_code, details: result.details })
        }

        return JSON.stringify({ markdown: result.markdown, hash: result.hash, draft: result.draft })
      } catch (error) {
        if (error instanceof Error) {
          return JSON.stringify({ error_code: "VALIDATION_ERROR", message: error.message })
        }
        return JSON.stringify({ error_code: "UNKNOWN_ERROR" })
      }
    },
  })

  return {
    openmath_artifacts_parse,
    openmath_artifacts_apply_patch,
  }
}
