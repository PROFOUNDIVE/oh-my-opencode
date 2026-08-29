import type { CampaignJobAttempt } from "../state"

type PreparedJob = Extract<CampaignJobAttempt, { readonly phase: "PREPARED" }>
type SessionCreatedJob = Extract<CampaignJobAttempt, { readonly phase: "SESSION_CREATED" }>

export type PreparedCampaignJobReconciliation =
  | { readonly kind: "create"; readonly child_title: string }
  | { readonly kind: "resume"; readonly child_session_id: string }
  | { readonly kind: "blocked"; readonly message: string }

export type SessionCreatedCampaignJobReconciliation =
  | { readonly kind: "send" }
  | { readonly kind: "resume" }
  | { readonly kind: "blocked"; readonly message: string }

export async function reconcilePreparedCampaignJob(input: Readonly<{
  readonly parent_session_id: string
  readonly attempt: PreparedJob
  readonly list_children: (parentSessionID: string) => Promise<readonly Readonly<{ readonly id: string }>[]>
  readonly get_session: (sessionID: string) => Promise<Readonly<{ readonly title: string }>>
}>): Promise<PreparedCampaignJobReconciliation> {
  let children: readonly Readonly<{ readonly id: string }>[]
  try {
    children = await input.list_children(input.parent_session_id)
  } catch (error) {
    return blocked("Unable to inspect child sessions for the persisted campaign job", error)
  }
  const matches: string[] = []
  for (const child of children) {
    try {
      const session = await input.get_session(child.id)
      if (session.title.startsWith(`[openmath-research:${input.attempt.idempotency_key}]`)) matches.push(child.id)
    } catch (error) {
      return blocked("Unable to inspect a child session for the persisted campaign job", error)
    }
  }
  if (matches.length === 0) return { kind: "create", child_title: input.attempt.child_title }
  if (matches.length === 1) {
    const childSessionID = matches[0]
    if (childSessionID !== undefined) return { kind: "resume", child_session_id: childSessionID }
  }
  return { kind: "blocked", message: "Multiple child sessions match the persisted campaign job key" }
}

export async function reconcileSessionCreatedCampaignJob(input: Readonly<{
  readonly attempt: SessionCreatedJob
  readonly list_messages: (sessionID: string) => Promise<readonly Readonly<{ readonly role: string; readonly text: string }>[]>
}>): Promise<SessionCreatedCampaignJobReconciliation> {
  let messages: readonly Readonly<{ readonly role: string; readonly text: string }>[]
  try {
    messages = await input.list_messages(input.attempt.child_session_id)
  } catch (error) {
    return blocked("Unable to inspect child transcript for the persisted campaign job", error)
  }
  const marker = `OPENMATH_RESEARCH_JOB_KEY: ${input.attempt.idempotency_key}\n`
  const count = messages.filter((message) => message.role === "user" && message.text.startsWith(marker)).length
  if (count === 0) return { kind: "send" }
  if (count === 1) return { kind: "resume" }
  return { kind: "blocked", message: "Multiple user prompts match the persisted campaign job key" }
}

function blocked(message: string, error: unknown): { readonly kind: "blocked"; readonly message: string } {
  const detail = error instanceof Error ? error.message : String(error)
  return { kind: "blocked", message: `${message}: ${detail}` }
}
