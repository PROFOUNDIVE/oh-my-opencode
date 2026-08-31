import type { CertificationJobAttempt } from "../state/jobs"

type PreparedJob = Extract<CertificationJobAttempt, { readonly phase: "PREPARED" }>
type SessionCreatedJob = Extract<CertificationJobAttempt, { readonly phase: "SESSION_CREATED" }>

export type CertificationReconciliationFailure =
  | Readonly<{ readonly kind: "DUPLICATE_CHILDREN"; readonly child_session_ids: readonly string[] }>
  | Readonly<{ readonly kind: "DUPLICATE_PROMPT_MARKERS"; readonly child_session_id: string; readonly marker_count: number }>
  | Readonly<{ readonly kind: "MISSING_PROMPT_MARKER"; readonly child_session_id: string }>
  | Readonly<{ readonly kind: "INSPECTION_FAILED"; readonly operation: "LIST_CHILDREN" | "GET_SESSION" | "LIST_MESSAGES"; readonly message: string }>

export type PreparedCertificationJobReconciliation =
  | Readonly<{ readonly kind: "create"; readonly child_title: string }>
  | Readonly<{ readonly kind: "resume"; readonly child_session_id: string }>
  | Readonly<{ readonly kind: "blocked"; readonly reason: "RECONCILIATION_AMBIGUOUS"; readonly evidence: CertificationReconciliationFailure }>

export type SessionCreatedCertificationJobReconciliation =
  | Readonly<{ readonly kind: "send" }>
  | Readonly<{ readonly kind: "resume" }>
  | Readonly<{ readonly kind: "blocked"; readonly reason: "RECONCILIATION_AMBIGUOUS"; readonly evidence: CertificationReconciliationFailure }>

export async function reconcilePreparedCertificationJob(input: Readonly<{
  readonly parent_session_id: string
  readonly attempt: PreparedJob
  readonly list_children: (parentSessionID: string) => Promise<readonly Readonly<{ readonly id: string }>[]>
  readonly get_session: (sessionID: string) => Promise<Readonly<{ readonly title: string }>>
}>): Promise<PreparedCertificationJobReconciliation> {
  let children: readonly Readonly<{ readonly id: string }>[]
  try {
    children = await input.list_children(input.parent_session_id)
  } catch (error) {
    return inspectionFailure("LIST_CHILDREN", error)
  }
  const matches: string[] = []
  for (const child of children) {
    try {
      const session = await input.get_session(child.id)
      if (session.title === input.attempt.child_title) matches.push(child.id)
    } catch (error) {
      return inspectionFailure("GET_SESSION", error)
    }
  }
  if (matches.length === 0) return { kind: "create", child_title: input.attempt.child_title }
  const childSessionID = matches[0]
  if (matches.length === 1 && childSessionID !== undefined) return { kind: "resume", child_session_id: childSessionID }
  return {
    kind: "blocked",
    reason: "RECONCILIATION_AMBIGUOUS",
    evidence: { kind: "DUPLICATE_CHILDREN", child_session_ids: matches },
  }
}

export async function reconcileSessionCreatedCertificationJob(input: Readonly<{
  readonly attempt: SessionCreatedJob
  readonly list_messages: (sessionID: string) => Promise<readonly Readonly<{ readonly role: string; readonly text: string }>[]>
}>): Promise<SessionCreatedCertificationJobReconciliation> {
  let messages: readonly Readonly<{ readonly role: string; readonly text: string }>[]
  try {
    messages = await input.list_messages(input.attempt.child_session_id)
  } catch (error) {
    return inspectionFailure("LIST_MESSAGES", error)
  }
  const marker = `OPENMATH_CERTIFICATION_JOB_KEY: ${input.attempt.idempotency_key}\n`
  const markerCount = messages.filter((message) => message.role === "user" && message.text.startsWith(marker)).length
  if (markerCount === 0) return { kind: "send" }
  if (markerCount === 1) return { kind: "resume" }
  return {
    kind: "blocked",
    reason: "RECONCILIATION_AMBIGUOUS",
    evidence: {
      kind: "DUPLICATE_PROMPT_MARKERS",
      child_session_id: input.attempt.child_session_id,
      marker_count: markerCount,
    },
  }
}

function inspectionFailure(
  operation: Extract<CertificationReconciliationFailure, { readonly kind: "INSPECTION_FAILED" }>["operation"],
  error: unknown,
): Extract<PreparedCertificationJobReconciliation, { readonly kind: "blocked" }> {
  return {
    kind: "blocked",
    reason: "RECONCILIATION_AMBIGUOUS",
    evidence: {
      kind: "INSPECTION_FAILED",
      operation,
      message: error instanceof Error ? error.message : String(error),
    },
  }
}
