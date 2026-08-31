import { writeImmutableJsonRevision } from "../../../revision-store/immutable-json-revision-writer"
import { nodeStorageRuntime } from "../../../workflow/storage/node-storage-runtime"
import type { StorageRuntime } from "../../../workflow/storage/storage-runtime-contract"
import type { CertificationStorageFailure } from "./storage-results"
import { getCertificationDirectory, getCertificationGenerationDirectory, getCertificationGenerationIndexPath, getCertificationRevisionPath } from "./paths"

type PublicationResult = { readonly kind: "ok" } | CertificationStorageFailure<"STORAGE_WRITE_FAILED" | "STORAGE_ATOMICITY_UNAVAILABLE">

async function publish(directory: string, path: string, serializedBytes: string, runtime: StorageRuntime): Promise<PublicationResult> {
  const result = await writeImmutableJsonRevision({
    run_directory: directory,
    build_revision_path: () => path,
    serialized_bytes: serializedBytes,
  }, runtime)
  if (result.kind === "ok") return result
  return {
    kind: "error",
    error_code: result.error_code,
    message: result.reason === "REVISION_ALREADY_ALLOCATED"
      ? "Immutable certification file is already allocated"
      : "Unable to publish immutable certification file",
  }
}

export async function writeImmutableCertificationRevision(
  request: {
    readonly directory: string
    readonly campaign_id: string
    readonly generation_id: string
    readonly revision: number
    readonly serialized_bytes: string
  },
  runtime: StorageRuntime = nodeStorageRuntime,
) {
  const generationDirectory = getCertificationGenerationDirectory(request.directory, request.campaign_id, request.generation_id)
  return publish(generationDirectory, getCertificationRevisionPath(generationDirectory, request.revision), request.serialized_bytes, runtime)
}

export async function writeImmutableCertificationGenerationIndex(
  request: { readonly directory: string; readonly campaign_id: string; readonly serialized_bytes: string },
  runtime: StorageRuntime = nodeStorageRuntime,
) {
  return publish(
    getCertificationDirectory(request.directory, request.campaign_id),
    getCertificationGenerationIndexPath(request.directory, request.campaign_id),
    request.serialized_bytes,
    runtime,
  )
}
