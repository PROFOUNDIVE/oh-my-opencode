export type JsonOutputParseResult =
  | Readonly<{ readonly ok: true; readonly value: unknown }>
  | Readonly<{ readonly ok: false }>

export function parseJsonOutput(rawOutput: string): JsonOutputParseResult {
  try {
    const value: unknown = JSON.parse(rawOutput)
    return { ok: true, value }
  } catch (error) {
    if (error instanceof SyntaxError) return { ok: false }
    throw error
  }
}
