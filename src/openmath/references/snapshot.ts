import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { dirname } from "node:path"
import { parseReferenceManifest } from "./manifest-parser"
import { resolveAllowedRoots, resolveManifestPath, resolveReferencePath } from "./path-resolver"
import { calculateReferenceBundleSha256 } from "./renderer"
import {
  REFERENCE_STAGES,
  ReferenceManifestError,
  type ReferenceDiagnostic,
  type ReferenceManifestEntry,
  type ReferenceSnapshot,
  type ReferenceSnapshotEntry,
  type ReferenceSource,
} from "./types"

export function loadReferenceSnapshot(input: {
  readonly referenceManifestPath: string
  readonly projectDirectory: string
  readonly configuredAllowedRoots?: readonly string[]
  readonly homeDirectory?: string
}): ReferenceSnapshot {
  const allowedRoots = resolveAllowedRoots({
    projectDirectory: input.projectDirectory,
    configuredRoots: input.configuredAllowedRoots,
    homeDirectory: input.homeDirectory,
  })
  const manifestPath = resolveManifestPath({
    referenceManifestPath: input.referenceManifestPath,
    projectDirectory: input.projectDirectory,
    allowedRoots,
    homeDirectory: input.homeDirectory,
  })
  const manifest = parseReferenceManifest({
    content: readUtf8File(manifestPath.canonicalPath, manifestPath.originalPath).content,
    manifestPath: manifestPath.resolvedPath,
  })
  const references: ReferenceSnapshotEntry[] = []
  const diagnostics: ReferenceDiagnostic[] = []

  for (const entry of manifest.references) {
    const captured = captureManifestReference({ entry, manifestPath: manifestPath.canonicalPath, allowedRoots })
    if (captured.kind === "missing_optional") {
      diagnostics.push(captured.diagnostic)
      continue
    }
    references.push(captured.reference)
  }

  return freezeReferenceSnapshot({
    version: 1,
    manifest: {
      kind: "file",
      originalPath: manifestPath.originalPath,
      resolvedPath: manifestPath.resolvedPath,
      canonicalPath: manifestPath.canonicalPath,
    },
    references,
    diagnostics,
    sha256: calculateReferenceBundleSha256(references),
  })
}

export function createLegacyReferenceSnapshot(supplementaryReferences: readonly string[]): ReferenceSnapshot {
  const references = supplementaryReferences.map((content, index): ReferenceSnapshotEntry => {
    const id = `supplementary-${index + 1}`
    return {
      id,
      role: "background",
      stages: [...REFERENCE_STAGES],
      required: true,
      content,
      sha256: createHash("sha256").update(Buffer.from(content, "utf8")).digest("hex"),
      source: { kind: "inline", path: `inline:${id}` },
    }
  })
  return freezeReferenceSnapshot({
    version: 1,
    manifest: { kind: "legacy_supplementary" },
    references,
    diagnostics: [],
    sha256: calculateReferenceBundleSha256(references),
  })
}

function freezeReferenceSnapshot(snapshot: ReferenceSnapshot): ReferenceSnapshot {
  for (const reference of snapshot.references) {
    Object.freeze(reference.stages)
    freezeReferenceSource(reference.source)
    Object.freeze(reference)
  }
  for (const diagnostic of snapshot.diagnostics) Object.freeze(diagnostic)
  Object.freeze(snapshot.references)
  Object.freeze(snapshot.diagnostics)
  freezeManifest(snapshot.manifest)
  return Object.freeze(snapshot)
}

function freezeReferenceSource(source: ReferenceSource): void {
  switch (source.kind) {
    case "file":
      Object.freeze(source)
      return
    case "inline":
      Object.freeze(source)
      return
    default:
      return assertNever(source)
  }
}

function freezeManifest(manifest: ReferenceSnapshot["manifest"]): void {
  switch (manifest.kind) {
    case "file":
      Object.freeze(manifest)
      return
    case "legacy_supplementary":
      Object.freeze(manifest)
      return
    default:
      return assertNever(manifest)
  }
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected reference snapshot variant: ${String(value)}`)
}

function captureManifestReference(input: {
  readonly entry: ReferenceManifestEntry
  readonly manifestPath: string
  readonly allowedRoots: ReturnType<typeof resolveAllowedRoots>
}): { readonly kind: "captured"; readonly reference: ReferenceSnapshotEntry } | {
  readonly kind: "missing_optional"
  readonly diagnostic: ReferenceDiagnostic
} {
  try {
    const resolvedPath = resolveReferencePath({
      declaredPath: input.entry.path,
      manifestDirectory: dirname(input.manifestPath),
      allowedRoots: input.allowedRoots,
    })
    const captured = readUtf8File(resolvedPath.canonicalPath, input.entry.path)
    return {
      kind: "captured",
      reference: {
        id: input.entry.id,
        role: input.entry.role,
        stages: [...input.entry.stages],
        required: input.entry.required,
        content: captured.content,
        sha256: captured.sha256,
        source: {
          kind: "file",
          declaredPath: input.entry.path,
          resolvedPath: resolvedPath.resolvedPath,
          canonicalPath: resolvedPath.canonicalPath,
          manifestCanonicalPath: input.manifestPath,
        },
      },
    }
  } catch (error) {
    if (!input.entry.required && error instanceof ReferenceManifestError && error.code === "missing") {
      return {
        kind: "missing_optional",
        diagnostic: { code: "optional_missing", id: input.entry.id, path: input.entry.path },
      }
    }
    throw error
  }
}

function readUtf8File(canonicalPath: string, sourcePath: string): {
  readonly content: string
  readonly sha256: string
} {
  let bytes: Buffer
  try {
    bytes = readFileSync(canonicalPath)
  } catch {
    throw new ReferenceManifestError("unreadable", sourcePath)
  }
  try {
    return {
      content: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      sha256: createHash("sha256").update(bytes).digest("hex"),
    }
  } catch {
    throw new ReferenceManifestError("invalid_utf8", sourcePath)
  }
}
