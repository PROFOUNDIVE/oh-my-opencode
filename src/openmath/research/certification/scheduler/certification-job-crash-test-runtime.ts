import type { CertificationJobAttempt } from "../state/jobs"
import type { CertificationJobReceiptSchema } from "../state/jobs"
import type { z } from "zod"
import type { CertificationStorageIdentityInput } from "../storage"
import { readCertificationGeneration } from "../storage"
import { blockCertificationJobOperation } from "./block-certification-job-operation"
import type {
  CertificationJobLifecycleUpdate,
  CertificationJobRuntime,
} from "./certification-job-runtime-types"
import { persistCertificationJobLifecycle } from "./persist-certification-job-lifecycle"

export type CertificationJobCrashBoundary =
  | "BEFORE_SESSION_CREATED"
  | "CHILD_CREATED"
  | "SESSION_CREATED"
  | "BEFORE_PROMPT_SENT"
  | "PROMPT_APPENDED"
  | "PROMPT_SENT"
  | "OUTPUT_FETCHED"
  | "BEFORE_COMPLETED"
  | "COMPLETED"

export function createCertificationJobCrashHarness(input: Readonly<{
  readonly directory: string
  readonly identity: CertificationStorageIdentityInput
  readonly initial_attempt: CertificationJobAttempt
  readonly receipt: z.infer<typeof CertificationJobReceiptSchema>
  readonly boundary: CertificationJobCrashBoundary
}>) {
  let crash: CertificationJobCrashBoundary | null = input.boundary
  const children: string[] = []
  const messages: string[] = []
  let childCreated = 0
  let promptSent = 0

  const persist = async (update: CertificationJobLifecycleUpdate) => {
    crashAt("BEFORE_COMPLETED", update.phase === "COMPLETED")
    const result = await persistCertificationJobLifecycle({
      directory: input.directory,
      identity: input.identity,
      update,
    })
    crashAt(update.phase, true)
    return result
  }

  const runtime = (): CertificationJobRuntime => ({
    verify_operation_owner: async () => ({ ok: true }),
    persist_job_attempt: persist,
    block_reconciliation: async (request) => blockCertificationJobOperation({
      directory: input.directory,
      identity: input.identity,
      job_id: request.job_id,
      evidence: request.evidence,
    }),
    list_children: async () => children.map((id) => ({ id })),
    get_session: async () => ({ title: input.initial_attempt.child_title }),
    list_messages: async () => messages.map((text) => ({ role: "user", text })),
    dispatch: async (request) => {
      crashAt("BEFORE_SESSION_CREATED", request.persisted_session_id === undefined)
      const sessionID = request.persisted_session_id ?? "ses_child1"
      if (request.persisted_session_id === undefined) {
        childCreated += 1
        children.push(sessionID)
        crashAt("CHILD_CREATED", true)
        await request.awaited_callbacks.on_session_created?.(sessionID)
      }
      crashAt("BEFORE_PROMPT_SENT", request.send_prompt)
      if (request.send_prompt) {
        promptSent += 1
        messages.push(`${request.prompt_marker}${request.user_prompt}`)
        crashAt("PROMPT_APPENDED", true)
        await request.awaited_callbacks.on_prompt_sent?.(sessionID)
      }
      crashAt("OUTPUT_FETCHED", true)
      return { ok: true, session_id: sessionID, text: "certification output" }
    },
  })

  function crashAt(boundary: CertificationJobCrashBoundary | CertificationJobLifecycleUpdate["phase"], active: boolean): void {
    if (!active || crash !== boundary) return
    const crashed = crash
    crash = null
    throw new Error(`crash after ${crashed}`)
  }

  return {
    runtime,
    current_attempt: async () => {
      const current = await readCertificationGeneration({ directory: input.directory, ...input.identity })
      if (current.kind !== "ok") throw new TypeError(current.kind === "error" ? current.message : "Certification not started")
      const attempt = current.state.job_attempts.find((candidate) => candidate.job_id === input.initial_attempt.job_id)
      if (attempt === undefined) throw new TypeError("Expected persisted certification job")
      return attempt
    },
    counts: () => ({ child_created: childCreated, prompt_sent: promptSent }),
  }
}
