import { stripWrapperFenceLines } from "./output-fence-stripper"

const END_MARKER_RE = /<\|end[^|>]*\|>/gi
const XML_TOOL_CALL_BLOCK_RE = /<tool_call\b[^>]*>[\s\S]*?<\/tool_call>/gi
const SELF_CLOSING_TOOL_TAG_RE = /<tool(?:_call)?\b[^>]*\/>/gi

function isToolJsonLine(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return false
  }

  try {
    const parsed = JSON.parse(trimmed)
    return (
      typeof parsed === "object"
      && parsed !== null
      && !Array.isArray(parsed)
      && typeof (parsed as Record<string, unknown>).tool === "string"
    )
  } catch {
    return false
  }
}

export function stripProtocolNoise(text: string): string {
  const withoutEndMarkers = text.replace(END_MARKER_RE, "")
  const withoutXmlToolBlocks = withoutEndMarkers.replace(XML_TOOL_CALL_BLOCK_RE, "")
  const withoutSelfClosingTags = withoutXmlToolBlocks.replace(SELF_CLOSING_TOOL_TAG_RE, "")
  const withoutFenceWrappers = stripWrapperFenceLines(withoutSelfClosingTags)

  const lines = withoutFenceWrappers.split("\n")
  const filtered = lines.filter((line) => {
    const trimmed = line.trim()
    if (trimmed.length === 0) {
      return true
    }

    if (isToolJsonLine(line)) {
      return false
    }

    if (trimmed.startsWith("<tool_call") && trimmed.endsWith("</tool_call>")) {
      return false
    }

    return true
  })

  return filtered.join("\n")
}
