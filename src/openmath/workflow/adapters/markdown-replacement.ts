import { createHash } from "node:crypto"

import type { AdapterResult, MarkdownArtifact } from "./types"

type MarkdownReplacementAdapter = "opaque_markdown" | "full_replace_markdown"

export function adaptMarkdownReplacement(
  adapter: MarkdownReplacementAdapter,
  rawOutput: string,
): AdapterResult {
  const content = normalizeReplacementMarkdown(rawOutput)
  if (content === undefined) {
    return {
      ok: false,
      error: {
        kind: "adapter_error",
        code: "EMPTY_MARKDOWN",
        message: "Markdown output must not be blank",
        raw_output: rawOutput,
      },
    }
  }

  const artifact: MarkdownArtifact = {
    media_type: "text/markdown",
    content,
    hash: createHash("sha256").update(Buffer.from(content, "utf8")).digest("hex"),
  }
  return { ok: true, kind: "markdown_artifact", adapter, artifact }
}

function normalizeReplacementMarkdown(rawOutput: string): string | undefined {
  const lineFeed = rawOutput.replace(/\r\n?/g, "\n")
  const content = `${lineFeed.replace(/\n+$/g, "")}\n`
  return content.trim().length === 0 ? undefined : content
}
