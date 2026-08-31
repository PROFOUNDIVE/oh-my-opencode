import { readCertificationOperationLock } from "../storage"
import type { CertificationOperationOwnershipResult } from "./certification-job-runtime-types"

export type CertificationOperationOwner = Readonly<{
  readonly operation_id: string
  readonly token: string
}>

export async function verifyCertificationOperationOwner(input: Readonly<{
  readonly directory: string
  readonly campaign_id: string
  readonly owner: CertificationOperationOwner
}>): Promise<CertificationOperationOwnershipResult> {
  const current = await readCertificationOperationLock({
    directory: input.directory,
    campaign_id: input.campaign_id,
  })
  if (current.kind === "error") return { ok: false, error_code: current.error_code, message: current.message }
  if (current.kind !== "owned" || current.process_status !== "live"
    || current.owner.token !== input.owner.token || current.owner.operation_id !== input.owner.operation_id) {
    return { ok: false, error_code: "STORAGE_BUSY", message: "Certification explicit-step operation ownership is not current" }
  }
  return { ok: true }
}
