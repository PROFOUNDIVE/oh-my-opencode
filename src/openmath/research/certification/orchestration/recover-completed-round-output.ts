import { sha256 } from "../../../workflow/stage-runner/sha256"
import type { CertificationJobRuntime } from "../scheduler"
import type { CertificationJobAttempt } from "../state/jobs"

type CompletedJob = Extract<CertificationJobAttempt, { readonly phase: "COMPLETED" }>

export type CompletedRoundOutputRecovery =
  | Readonly<{ readonly ok: true; readonly raw_output: string }>
  | Readonly<{ readonly ok: false; readonly message: string }>

export async function recoverCompletedRoundOutput(
  job: CompletedJob,
  runtime: CertificationJobRuntime,
): Promise<CompletedRoundOutputRecovery> {
  try {
    const messages = await runtime.list_messages(job.child_session_id)
    const matches = messages.filter((message) => message.role === "assistant" && sha256(message.text) === job.raw_output_sha256)
    const output = matches[0]?.text
    return matches.length === 1 && output !== undefined
      ? { ok: true, raw_output: output }
      : { ok: false, message: "Completed certification output is missing or ambiguous" }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    }
  }
}
