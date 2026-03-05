export type MarkdownPatchFailure = { error_code: string; section_id?: string }

export type MarkdownPatchFailureState = {
  consecutive_failures: number
  last_error_code?: string
  last_section_id?: string
}

export type MarkdownOrchestratorState = {
  artifacts_format: "markdown"
  artifacts_markdown: string
  artifacts_hash: string
  last_blocking_issues?: unknown
  patch_failure_state?: MarkdownPatchFailureState
  last_patch_failure?: MarkdownPatchFailure | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

export function readMarkdownOrchestratorState(hintLadder: Record<string, unknown>): MarkdownOrchestratorState | null {
  const raw = (hintLadder as any).__orchestrator_state
  if (!isRecord(raw)) return null
  if (raw.artifacts_format !== "markdown") return null
  if (typeof raw.artifacts_markdown !== "string") return null
  if (typeof raw.artifacts_hash !== "string") return null
  return raw as MarkdownOrchestratorState
}

export function mergeMarkdownOrchestratorState(
  hintLadder: Record<string, unknown>,
  update: Partial<MarkdownOrchestratorState>,
): Record<string, unknown> {
  const current = readMarkdownOrchestratorState(hintLadder)
  if (!current) return hintLadder
  return { ...hintLadder, __orchestrator_state: { ...current, ...update } }
}

export function nextPatchFailureState(args: {
  prev: MarkdownPatchFailureState | undefined
  failure: MarkdownPatchFailure | null
  resetOnSuccess: boolean
}): MarkdownPatchFailureState | undefined {
  if (!args.failure) {
    return args.resetOnSuccess ? { consecutive_failures: 0 } : args.prev
  }

  const prevSig = `${args.prev?.last_error_code ?? ""}::${args.prev?.last_section_id ?? ""}`
  const nextSig = `${args.failure.error_code}::${args.failure.section_id ?? ""}`

  const consecutive = prevSig === nextSig ? (args.prev?.consecutive_failures ?? 0) + 1 : 1
  return {
    consecutive_failures: consecutive,
    last_error_code: args.failure.error_code,
    ...(args.failure.section_id ? { last_section_id: args.failure.section_id } : {}),
  }
}
