export function buildJsonPrompt(payload: Record<string, unknown>): string {
  return JSON.stringify(payload, null, 2)
}

export function normalizeProblem(prefix: string | undefined, problem: string): string {
  return prefix ? `${prefix}\n${problem}` : problem
}

export function safeJsonParse(text: string): unknown | null {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
