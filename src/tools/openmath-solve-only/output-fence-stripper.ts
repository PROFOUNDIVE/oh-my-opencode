const WRAPPER_FENCE_LINE_RE = /^\s*```[\w-]*\s*$/
const SECTION_START_RE = /^\s*<!--\s*OMO:SECTION\s+[a-z0-9_]+\s*-->\s*$/
const SECTION_END_RE = /^\s*<!--\s*OMO:ENDSECTION\s*-->\s*$/

export function stripWrapperFenceLines(text: string): string {
  const lines = text.split("\n")
  let openSectionCount = 0

  const filtered = lines.filter((line) => {
    if (SECTION_START_RE.test(line)) {
      openSectionCount += 1
      return true
    }

    if (SECTION_END_RE.test(line)) {
      openSectionCount = Math.max(0, openSectionCount - 1)
      return true
    }

    if (openSectionCount > 0) {
      return true
    }

    return !WRAPPER_FENCE_LINE_RE.test(line)
  })

  return filtered.join("\n")
}
