import { sha256 } from "../../../workflow/stage-runner/sha256"
import type { StorageRuntime } from "../../../workflow/storage/storage-runtime-contract"
import { getFilesystemErrorCode } from "../../storage/filesystem-error-code"
import { CertificationGenerationIndexReadSchema } from "../state/generation-index-read"
import { CertificationGenerationIndexV1Schema } from "../state/identity"
import { getCertificationGenerationIndexPath } from "./paths"
import type { CertificationStorageIdentity } from "./storage-identity"
import type { CertificationReadFailure } from "./storage-results"

type IndexReadResult =
  | { readonly kind: "missing" }
  | { readonly kind: "ok"; readonly index: ReturnType<typeof CertificationGenerationIndexV1Schema.parse>; readonly content_sha256: string }
  | CertificationReadFailure

function parseJson(bytes: string): unknown {
  try {
    return JSON.parse(bytes)
  } catch (error) {
    if (error instanceof SyntaxError) return null
    throw error
  }
}

export async function readCertificationGenerationIndex(
  directory: string,
  identity: CertificationStorageIdentity,
  runtime: StorageRuntime,
): Promise<IndexReadResult> {
  let rawBytes: Uint8Array
  try {
    rawBytes = await runtime.readBytes(getCertificationGenerationIndexPath(directory, identity.campaign_id))
  } catch (error) {
    if (getFilesystemErrorCode(error) === "ENOENT") return { kind: "missing" }
    return { kind: "error", error_code: "STORAGE_READ_FAILED", message: "Unable to read certification generation index" }
  }
  let bytes: string
  try {
    bytes = new TextDecoder("utf-8", { fatal: true }).decode(rawBytes)
  } catch (error) {
    if (!(error instanceof TypeError)) throw error
    return { kind: "error", error_code: "STORAGE_READ_FAILED", reason: "INVALID_IDENTITY", message: "Certification generation index is not valid UTF-8" }
  }
  const validated = CertificationGenerationIndexReadSchema.safeParse({
    serialized_bytes: bytes,
    expected_campaign_id: identity.campaign_id,
    expected_selected_artifact: identity.selected_artifact,
    expected_certification_profile_sha256: identity.certification_profile_sha256,
    expected_initialized_from_campaign_revision: identity.initialized_from_campaign_revision,
  })
  const parsed = CertificationGenerationIndexV1Schema.safeParse(parseJson(bytes))
  if (!validated.success || !parsed.success) {
    return { kind: "error", error_code: "STORAGE_READ_FAILED", reason: "INVALID_IDENTITY", message: "Certification generation index is invalid" }
  }
  return { kind: "ok", index: parsed.data, content_sha256: sha256(rawBytes) }
}
