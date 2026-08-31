import { createHash } from "node:crypto"
import { accessSync, constants, readFileSync, realpathSync, statSync, type Stats } from "node:fs"
import { decodeFileUri, type DecodedFileUri } from "./file-uri-decoder"

export type ReplacementPrompt = {
  readonly content: string
  readonly uri: string
  readonly path: string
  readonly canonicalPath: string
  readonly sha256: string
}

export type ResolvedReplacementPromptSource = {
  readonly originalPath: string
  readonly resolvedPath: string
  readonly canonicalPath: string
}

export type ReplacementPromptDiagnosticCode =
  | "malformed"
  | "missing"
  | "non_regular"
  | "unreadable"
  | "invalid_utf8"

export class ReplacementPromptDiagnostic extends Error {
  readonly name = "ReplacementPromptDiagnostic"

  constructor(
    readonly code: ReplacementPromptDiagnosticCode,
    readonly uri: string,
    readonly path?: string,
  ) {
    super(`ReplacementPromptDiagnostic: ${code}: ${uri}`)
  }
}

export function resolveReplacementPrompt(fileUri: string, configDir?: string): ReplacementPrompt {
  const decoded = decodeReplacementUri(fileUri, configDir)
  const canonicalPath = resolveCanonicalPath(fileUri, decoded)
  return readResolvedReplacementPrompt({ originalPath: fileUri, resolvedPath: decoded.path, canonicalPath })
}

export function readResolvedReplacementPrompt(source: ResolvedReplacementPromptSource): ReplacementPrompt {
  const stats = readSourceStats(source.originalPath, source.canonicalPath)

  if (!stats.isFile()) {
    throw new ReplacementPromptDiagnostic("non_regular", source.originalPath, source.canonicalPath)
  }
  if ((stats.mode & 0o444) === 0) {
    throw new ReplacementPromptDiagnostic("unreadable", source.originalPath, source.canonicalPath)
  }

  try {
    accessSync(source.canonicalPath, constants.R_OK)
    const bytes = readFileSync(source.canonicalPath)
    const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    return {
      content,
      uri: source.originalPath,
      path: source.resolvedPath,
      canonicalPath: source.canonicalPath,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    }
  } catch (error) {
    if (error instanceof TypeError) {
      throw new ReplacementPromptDiagnostic("invalid_utf8", source.originalPath, source.canonicalPath)
    }
    throw new ReplacementPromptDiagnostic("unreadable", source.originalPath, source.canonicalPath)
  }
}

function decodeReplacementUri(fileUri: string, configDir?: string): DecodedFileUri {
  try {
    return decodeFileUri(fileUri, configDir)
  } catch {
    throw new ReplacementPromptDiagnostic("malformed", fileUri)
  }
}

function resolveCanonicalPath(fileUri: string, decoded: DecodedFileUri): string {
  try {
    return realpathSync(decoded.path)
  } catch (error) {
    throw new ReplacementPromptDiagnostic(getDiagnosticCode(error), fileUri, decoded.path)
  }
}

function readSourceStats(fileUri: string, canonicalPath: string): Stats {
  try {
    return statSync(canonicalPath)
  } catch (error) {
    throw new ReplacementPromptDiagnostic(getDiagnosticCode(error), fileUri, canonicalPath)
  }
}

function getDiagnosticCode(error: unknown): "missing" | "unreadable" {
  return error instanceof Error && "code" in error && error.code === "ENOENT"
    ? "missing"
    : "unreadable"
}
