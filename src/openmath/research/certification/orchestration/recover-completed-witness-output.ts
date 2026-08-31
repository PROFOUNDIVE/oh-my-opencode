import { sha256 } from "../../../workflow/stage-runner/sha256"
import type { CertificationJobRuntime } from "../scheduler"
import type { CertificationJobAttempt } from "../state/jobs"

type CompletedJob = Extract<CertificationJobAttempt, { readonly phase: "COMPLETED" }>
type WitnessTarget = Extract<CertificationJobAttempt["target"], { readonly kind: "WITNESS" }>
type CompletedWitnessJob = Omit<CompletedJob, "target"> & Readonly<{ readonly target: WitnessTarget }>

export async function recoverCompletedWitnessOutput(
  job: CompletedWitnessJob,
  runtime: CertificationJobRuntime,
): Promise<Readonly<{ readonly ok: true; readonly raw_output: string }> | Readonly<{ readonly ok: false; readonly message: string }>> {
  try {
    const messages = await runtime.list_messages(job.child_session_id)
    const matches = messages.filter((message) => message.role === "assistant" && sha256(message.text) === job.raw_output_sha256)
    const output = matches[0]?.text
    return matches.length === 1 && output !== undefined
      ? { ok: true, raw_output: output }
      : { ok: false, message: "Completed witness output is missing or ambiguous" }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}
