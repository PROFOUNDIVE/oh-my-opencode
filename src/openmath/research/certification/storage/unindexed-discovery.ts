import type { StorageRuntime } from "../../../workflow/storage/storage-runtime-contract"
import { getFilesystemErrorCode } from "../../storage/filesystem-error-code"
import { CertificationGenerationIdSchema } from "../state/literals"
import { getCertificationDirectory, getCertificationGenerationDirectory } from "./paths"
import { parseCertificationRevisionFilename } from "./paths"

export async function hasUnindexedCertificationRevision(
  directory: string,
  campaignId: string,
  runtime: StorageRuntime,
): Promise<boolean | null> {
  let entries: readonly string[]
  try {
    entries = await runtime.readdir(getCertificationDirectory(directory, campaignId))
  } catch (error) {
    return getFilesystemErrorCode(error) === "ENOENT" ? false : null
  }
  for (const entry of entries) {
    const generation = CertificationGenerationIdSchema.safeParse(entry)
    if (!generation.success) continue
    try {
      const files = await runtime.readdir(getCertificationGenerationDirectory(directory, campaignId, generation.data))
      if (files.some((file) => parseCertificationRevisionFilename(file) !== null)) return true
    } catch (error) {
      if (getFilesystemErrorCode(error) !== "ENOENT") return null
    }
  }
  return false
}
