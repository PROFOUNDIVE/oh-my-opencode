import { createHash } from "node:crypto"

function normalizeMarkdown(markdown: string): string {
  const lf = markdown.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
  const trimmed = lf
    .split("\n")
    .map((line) => line.replace(/[\t ]+$/g, ""))
    .join("\n")
    .replace(/\n+$/g, "")
  return `${trimmed}\n`
}

export function hashOpenMathArtifactsMarkdown(markdown: string): string {
  const normalized = normalizeMarkdown(markdown)
  return createHash("sha256").update(normalized).digest("base64url")
}
