export const REFERENCE_ROLES = [
  "authoritative",
  "accepted_prior",
  "background",
  "candidate",
  "empirical_evidence",
] as const

export const REFERENCE_STAGES = ["solve", "review", "revise"] as const

export type ReferenceRole = (typeof REFERENCE_ROLES)[number]
export type ReferenceStage = (typeof REFERENCE_STAGES)[number]

export type ReferenceManifestEntry = {
  readonly id: string
  readonly path: string
  readonly role: ReferenceRole
  readonly stages: readonly ReferenceStage[]
  readonly required: boolean
}

export type ReferenceManifestV1 = {
  readonly version: 1
  readonly references: readonly ReferenceManifestEntry[]
}

export type ResolvedAllowedRoots = {
  readonly canonicalPaths: readonly string[]
}

export type ResolvedManifestPath = {
  readonly originalPath: string
  readonly resolvedPath: string
  readonly canonicalPath: string
}

export type ResolvedReferencePath = {
  readonly declaredPath: string
  readonly resolvedPath: string
  readonly canonicalPath: string
}

export type FileReferenceSource = {
  readonly kind: "file"
  readonly declaredPath: string
  readonly resolvedPath: string
  readonly canonicalPath: string
  readonly manifestCanonicalPath: string
}

export type InlineReferenceSource = {
  readonly kind: "inline"
  readonly path: string
}

export type ReferenceSource = FileReferenceSource | InlineReferenceSource

export type ReferenceSnapshotEntry = {
  readonly id: string
  readonly role: ReferenceRole
  readonly stages: readonly ReferenceStage[]
  readonly required: boolean
  readonly content: string
  readonly sha256: string
  readonly source: ReferenceSource
}

export type ReferenceDiagnostic = {
  readonly code: "optional_missing"
  readonly id: string
  readonly path: string
}

export type ReferenceSnapshot = {
  readonly version: number
  readonly manifest:
    | {
      readonly kind: "file"
      readonly originalPath: string
      readonly resolvedPath: string
      readonly canonicalPath: string
    }
    | { readonly kind: "legacy_supplementary" }
  readonly references: readonly ReferenceSnapshotEntry[]
  readonly diagnostics: readonly ReferenceDiagnostic[]
  readonly sha256: string
}

export type ReferenceBundle = {
  readonly stage: ReferenceStage
  readonly references: readonly ReferenceSnapshotEntry[]
  readonly content: string
  readonly sha256: string
}

export const REFERENCE_MANIFEST_ERROR_CODES = [
  "invalid_path",
  "missing",
  "unreadable",
  "not_directory",
  "non_regular",
  "outside_allowed_roots",
  "unsupported_extension",
  "invalid_utf8",
  "invalid_syntax",
  "invalid_schema",
  "duplicate_id",
] as const

export type ReferenceManifestErrorCode = (typeof REFERENCE_MANIFEST_ERROR_CODES)[number]

export class ReferenceManifestError extends Error {
  readonly name = "ReferenceManifestError"

  constructor(
    readonly code: ReferenceManifestErrorCode,
    readonly sourcePath: string,
  ) {
    super(`Reference manifest ${code}: ${sourcePath}`)
  }
}
