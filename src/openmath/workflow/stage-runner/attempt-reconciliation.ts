import type { WorkflowStateV1 } from "../state"

type PreparedAttempt = Extract<WorkflowStateV1["dispatch_attempts"][number], { readonly phase: "PREPARED" }>
type SessionCreatedAttempt = Extract<WorkflowStateV1["dispatch_attempts"][number], { readonly phase: "SESSION_CREATED" }>

type ChildSession = Readonly<{ readonly id: string }>
type ChildDetails = Readonly<{ readonly title: string }>
type SessionMessage = Readonly<{ readonly role: string; readonly text: string }>

export type PreparedReconciliation =
  | Readonly<{ readonly kind: "create"; readonly child_title: string }>
  | Readonly<{ readonly kind: "resume"; readonly child_session_id: string }>
  | Readonly<{ readonly kind: "blocked"; readonly message: string }>

export type SessionCreatedReconciliation =
  | Readonly<{ readonly kind: "send" }>
  | Readonly<{ readonly kind: "resume" }>
  | Readonly<{ readonly kind: "blocked"; readonly message: string }>

export async function reconcilePreparedAttempt(input: Readonly<{
  readonly parent_session_id: string
  readonly attempt: PreparedAttempt
  readonly list_children: (parentSessionID: string) => Promise<readonly ChildSession[]>
  readonly get_session: (sessionID: string) => Promise<ChildDetails>
}>): Promise<PreparedReconciliation> {
  let children: readonly ChildSession[]
  try {
    children = await input.list_children(input.parent_session_id)
  } catch (error) {
    return preparedBlocked("Unable to inspect child sessions for the persisted attempt", error)
  }

  const matching: string[] = []
  for (const child of children) {
    try {
      const session = await input.get_session(child.id)
      if (session.title.startsWith(`[openmath:${input.attempt.idempotency_key}]`)) matching.push(child.id)
    } catch (error) {
      return preparedBlocked("Unable to inspect a child session for the persisted attempt", error)
    }
  }

  if (matching.length === 0) return { kind: "create", child_title: input.attempt.child_title }
  if (matching.length === 1) {
    const [childSessionID] = matching
    if (childSessionID !== undefined) return { kind: "resume", child_session_id: childSessionID }
  }
  return { kind: "blocked", message: "Multiple child sessions match the persisted attempt key" }
}

export async function reconcileSessionCreatedAttempt(input: Readonly<{
  readonly attempt: SessionCreatedAttempt
  readonly list_messages: (sessionID: string) => Promise<readonly SessionMessage[]>
}>): Promise<SessionCreatedReconciliation> {
  let messages: readonly SessionMessage[]
  try {
    messages = await input.list_messages(input.attempt.child_session_id)
  } catch (error) {
    return sessionCreatedBlocked("Unable to inspect child transcript for the persisted attempt", error)
  }
  const marker = `OPENMATH_ATTEMPT_KEY: ${input.attempt.idempotency_key}\n`
  const count = messages.filter((message) => message.role === "user" && message.text.startsWith(marker)).length
  if (count === 0) return { kind: "send" }
  if (count === 1) return { kind: "resume" }
  return { kind: "blocked", message: "Multiple user prompts match the persisted attempt key" }
}

function preparedBlocked(message: string, error: unknown): Extract<PreparedReconciliation, { readonly kind: "blocked" }> {
  const detail = error instanceof Error ? error.message : String(error)
  return { kind: "blocked", message: `${message}: ${detail}` }
}

function sessionCreatedBlocked(message: string, error: unknown): Extract<SessionCreatedReconciliation, { readonly kind: "blocked" }> {
  const detail = error instanceof Error ? error.message : String(error)
  return { kind: "blocked", message: `${message}: ${detail}` }
}
