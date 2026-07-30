import { createLegacyReferenceSnapshot, loadReferenceSnapshot } from "../../openmath/references/snapshot"
import { ReferenceManifestError } from "../../openmath/references/types"
import { ReferenceSnapshotSchema, type WorkflowStateV1 } from "../../openmath/workflow/state"
import type { OpenMathConfig } from "../../config/schema"

export function resolveInitialReferenceSnapshot(input: Readonly<{
  readonly request_references: readonly string[] | undefined
  readonly reference_manifest_path: string | undefined
  readonly config: OpenMathConfig
  readonly directory: string
}>): WorkflowStateV1["reference_snapshot"] {
  if (input.reference_manifest_path === undefined) {
    return ReferenceSnapshotSchema.parse(createLegacyReferenceSnapshot(input.request_references ?? []))
  }
  return ReferenceSnapshotSchema.parse(loadReferenceSnapshot({
    referenceManifestPath: input.reference_manifest_path,
    projectDirectory: input.directory,
    configuredAllowedRoots: input.config.workflow_allowed_roots,
  }))
}

export function reloadReferenceSnapshot(input: Readonly<{
  readonly snapshot: WorkflowStateV1["reference_snapshot"]
  readonly config: OpenMathConfig
  readonly directory: string
}>): WorkflowStateV1["reference_snapshot"] {
  if (input.snapshot.manifest.kind !== "file") {
    throw new ReferenceManifestError("invalid_path", "Workflow has no persisted reference manifest")
  }
  const reloaded = loadReferenceSnapshot({
    referenceManifestPath: input.snapshot.manifest.originalPath,
    projectDirectory: input.directory,
    configuredAllowedRoots: input.config.workflow_allowed_roots,
  })
  return ReferenceSnapshotSchema.parse({ ...reloaded, version: input.snapshot.version + 1 })
}
