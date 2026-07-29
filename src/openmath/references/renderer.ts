import { createHash } from "node:crypto"
import type {
  ReferenceBundle,
  ReferenceSnapshot,
  ReferenceSnapshotEntry,
  ReferenceSource,
  ReferenceStage,
} from "./types"

export function renderReferenceBundle(snapshot: ReferenceSnapshot, stage: ReferenceStage): ReferenceBundle {
  const references = snapshot.references.filter((reference) => reference.stages.includes(stage))
  const sha256 = calculateReferenceBundleSha256(references)
  const metadata = [
    "# OpenMath Reference Bundle",
    `Stage: ${stage}`,
    `SHA-256: ${sha256}`,
  ].join("\n")
  const content = [metadata, ...references.map(renderReference)].join("\n\n").concat("\n")
  return { stage, references, content, sha256 }
}

export function calculateReferenceBundleSha256(references: readonly ReferenceSnapshotEntry[]): string {
  const frames = [frame(Buffer.from("openmath-reference-bundle-v1", "utf8")), countFrame(references.length)]
  for (const reference of references) {
    frames.push(
      frame(Buffer.from(reference.id, "utf8")),
      frame(Buffer.from(reference.role, "utf8")),
      frame(Buffer.from(sourcePath(reference.source), "utf8")),
      frame(Buffer.from(reference.sha256, "utf8")),
      frame(Buffer.from(reference.content, "utf8")),
    )
  }
  return createHash("sha256").update(Buffer.concat(frames)).digest("hex")
}

function renderReference(reference: ReferenceSnapshotEntry): string {
  return [
    `## Reference: ${reference.id}`,
    `Role: ${reference.role}`,
    `Path: ${sourcePath(reference.source)}`,
    `SHA-256: ${reference.sha256}`,
    "",
    reference.content,
  ].join("\n")
}

function sourcePath(source: ReferenceSource): string {
  switch (source.kind) {
    case "file":
      return source.canonicalPath
    case "inline":
      return source.path
    default:
      return assertNever(source)
  }
}

function frame(value: Buffer): Buffer {
  return Buffer.concat([countFrame(value.length), value])
}

function countFrame(value: number): Buffer {
  const output = Buffer.alloc(8)
  output.writeBigUInt64BE(BigInt(value))
  return output
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected reference source: ${String(value)}`)
}
