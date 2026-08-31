import { sha256 } from "../../../workflow/stage-runner/sha256"
import type { StorageRuntime } from "../../../workflow/storage/storage-runtime-contract"
import { ResearchCertificationStateV1Schema } from "../state/schema"
import { getFilesystemErrorCode } from "../../storage/filesystem-error-code"
import { getCertificationRevisionPath, parseCertificationRevisionFilename } from "./paths"
import type { CertificationReadFailure } from "./storage-results"

type RevisionReadResult =
  | { readonly kind: "missing" }
  | { readonly kind: "ok"; readonly state: ReturnType<typeof ResearchCertificationStateV1Schema.parse>; readonly content_sha256: string }
  | CertificationReadFailure

function parseJson(bytes: string): unknown {
  try {
    return JSON.parse(bytes)
  } catch (error) {
    if (error instanceof SyntaxError) return null
    throw error
  }
}

export async function readHighestCertificationRevision(
  generationDirectory: string,
  runtime: StorageRuntime,
): Promise<RevisionReadResult> {
  let filenames: readonly string[]
  try {
    filenames = await runtime.readdir(generationDirectory)
  } catch (error) {
    if (getFilesystemErrorCode(error) === "ENOENT") return { kind: "missing" }
    return { kind: "error", error_code: "STORAGE_READ_FAILED", reason: "UNREADABLE_REVISION", message: "Unable to list certification revisions" }
  }
  const revisions = filenames
    .map(parseCertificationRevisionFilename)
    .filter((revision): revision is number => revision !== null)
    .sort((left, right) => right - left)
  const highest = revisions[0]
  if (highest === undefined) return { kind: "missing" }
  let rawBytes: Uint8Array
  try {
    rawBytes = await runtime.readBytes(getCertificationRevisionPath(generationDirectory, highest))
  } catch (error) {
    if (!(error instanceof Error)) throw error
    return { kind: "error", error_code: "STORAGE_READ_FAILED", reason: "UNREADABLE_REVISION", message: "Highest certification revision is unreadable" }
  }
  let bytes: string
  try {
    bytes = new TextDecoder("utf-8", { fatal: true }).decode(rawBytes)
  } catch (error) {
    if (!(error instanceof TypeError)) throw error
    return { kind: "error", error_code: "STORAGE_READ_FAILED", reason: "UNREADABLE_REVISION", message: "Highest certification revision is not valid UTF-8" }
  }
  const parsed = ResearchCertificationStateV1Schema.safeParse(parseJson(bytes))
  if (!parsed.success || JSON.stringify(parsed.data) !== bytes || parsed.data.certification_revision !== highest) {
    return { kind: "error", error_code: "STORAGE_READ_FAILED", reason: "UNREADABLE_REVISION", message: "Highest certification revision is invalid" }
  }
  return { kind: "ok", state: parsed.data, content_sha256: sha256(rawBytes) }
}
