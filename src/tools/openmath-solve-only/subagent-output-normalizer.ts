const END_MARKER_RE = /<\|end[^|>]*\|>/gi

function stripProtocolNoise(text: string): string {
  const withoutMarkers = text.replace(END_MARKER_RE, "")
  const lines = withoutMarkers.split("\n")
  const filtered = lines.filter((line) => {
    const trimmed = line.trim()
    if (trimmed === "") return true
    if (!trimmed.startsWith("{")) return true
    if (!trimmed.endsWith("}")) return true

    try {
      const parsed = JSON.parse(trimmed)
      if (
        parsed
        && typeof parsed === "object"
        && !Array.isArray(parsed)
        && typeof (parsed as Record<string, unknown>).tool === "string"
      ) {
        return false
      }
    } catch {
      return true
    }

    return true
  })
  return filtered.join("\n")
}

export function extractNormalizedMarkdownArtifacts(text: string): string | null {
  const cleaned = stripProtocolNoise(text)
  const start = cleaned.indexOf("<!-- OMO:SECTION ")
  if (start < 0) return null

  const endMarker = "<!-- OMO:ENDSECTION -->"
  const end = cleaned.lastIndexOf(endMarker)
  if (end < 0 || end < start) return null

  const out = cleaned.slice(start, end + endMarker.length).trim()
  return out.length > 0 ? `${out}\n` : null
}

export function extractNormalizedJsonPayload(text: string): string | null {
  const cleaned = stripProtocolNoise(text)
  const lines = cleaned
    .split("\n")
    .map((line) => line.trimEnd())

  for (let start = lines.length - 1; start >= 0; start--) {
    const candidate = lines.slice(start).join("\n").trim()
    if (candidate.length === 0) continue
    if (!candidate.startsWith("{") && !candidate.startsWith("[")) continue
    if (!candidate.endsWith("}") && !candidate.endsWith("]")) continue

    try {
      JSON.parse(candidate)
      return candidate
    } catch {
      continue
    }
  }

  return null
}
