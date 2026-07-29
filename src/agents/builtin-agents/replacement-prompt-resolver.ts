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
  const stats = readSourceStats(fileUri, canonicalPath)

  if (!stats.isFile()) {
    throw new ReplacementPromptDiagnostic("non_regular", fileUri, canonicalPath)
  }
  if ((stats.mode & 0o444) === 0) {
    throw new ReplacementPromptDiagnostic("unreadable", fileUri, canonicalPath)
  }

  try {
    accessSync(canonicalPath, constants.R_OK)
    const bytes = readFileSync(canonicalPath)
    const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    return {
      content,
      uri: fileUri,
      path: decoded.path,
      canonicalPath,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    }
  } catch (error) {
    if (error instanceof TypeError) {
      throw new ReplacementPromptDiagnostic("invalid_utf8", fileUri, canonicalPath)
    }
    throw new ReplacementPromptDiagnostic("unreadable", fileUri, canonicalPath)
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
