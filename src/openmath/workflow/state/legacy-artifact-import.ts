import { createHash } from "node:crypto"
import { z } from "zod"

import { parseOpenMathArtifactsMarkdown } from "../../artifacts-markdown/parse"
import { hashOpenMathArtifactsMarkdown } from "../../artifacts-markdown/hash"
import { ArtifactDtoSchema, LegacyFrozenArtifactsSchema } from "./contracts"
import { LegacyMarkdownHashSchema } from "./legacy-markdown-hash"

const RetainedMarkdownSchema = z.object({
  artifacts_format: z.literal("markdown"),
  artifacts_markdown: z.string().min(1),
  artifacts_hash: LegacyMarkdownHashSchema,
}).strip()

type LegacyArtifactInput = {
  readonly frozen_artifacts: z.infer<typeof LegacyFrozenArtifactsSchema> | null
  readonly artifact_version: number
  readonly profile_name: string
}

type LegacyArtifactResult =
  | { readonly ok: true; readonly artifact: z.infer<typeof ArtifactDtoSchema> | null }
  | { readonly ok: false; readonly message: string }

export function createLegacyImportedArtifact(input: LegacyArtifactInput): LegacyArtifactResult {
  if (input.frozen_artifacts === null) return { ok: true, artifact: null }
  if (input.profile_name === "legacy-educational-json") {
    const content = JSON.stringify(input.frozen_artifacts)
    return {
      ok: true,
      artifact: {
        version: input.artifact_version,
        media_type: "application/vnd.openmath.legacy+json",
        content,
        sha256: hashText(content),
      },
    }
  }

  const metadata = RetainedMarkdownSchema.safeParse(
    input.frozen_artifacts.hint_ladder["__orchestrator_state"],
  )
  if (!metadata.success) return { ok: false, message: "Legacy markdown metadata is invalid" }
  const parsed = parseOpenMathArtifactsMarkdown(metadata.data.artifacts_markdown)
  if (!parsed.ok || parsed.normalizedMarkdown !== metadata.data.artifacts_markdown) {
    return { ok: false, message: "Retained legacy markdown is not canonical" }
  }
  if (hashOpenMathArtifactsMarkdown(metadata.data.artifacts_markdown) !== metadata.data.artifacts_hash) {
    return { ok: false, message: "Retained legacy markdown hash does not match" }
  }
  return {
    ok: true,
    artifact: {
      version: input.artifact_version,
      media_type: "text/markdown",
      content: metadata.data.artifacts_markdown,
      sha256: hashText(metadata.data.artifacts_markdown),
    },
  }
}

function hashText(content: string): string {
  return createHash("sha256").update(Buffer.from(content, "utf8")).digest("hex")
}
