export function computeLineHash(_lineNumber: number, content: string): string {
  const stripped = content.replace(/\s+/g, "")
  const hash = Bun.hash.xxHash32(stripped)
  const value = hash % 256
  return value.toString(16).padStart(2, "0")
}
