import { realpathSync, statSync, type Stats } from "node:fs"
import { homedir } from "node:os"
import { isAbsolute, relative, resolve, sep } from "node:path"
import {
  ReferenceManifestError,
  type ResolvedAllowedRoots,
  type ResolvedManifestPath,
  type ResolvedReferencePath,
} from "./types"

export function resolveAllowedRoots(input: {
  readonly projectDirectory: string
  readonly configuredRoots?: readonly string[]
  readonly homeDirectory?: string
}): ResolvedAllowedRoots {
  const homeDirectory = input.homeDirectory ?? homedir()
  const configuredRoots = input.configuredRoots ?? ["."]
  return {
    canonicalPaths: configuredRoots.map((configuredRoot) => {
      const resolvedPath = resolveFromProject(configuredRoot, input.projectDirectory, homeDirectory)
      const canonicalPath = canonicalPathOrThrow(resolvedPath, configuredRoot)
      const stats = statsOrThrow(canonicalPath, configuredRoot)
      if (!stats.isDirectory()) {
        throw new ReferenceManifestError("not_directory", configuredRoot)
      }
      return canonicalPath
    }),
  }
}

export function resolveManifestPath(input: {
  readonly referenceManifestPath: string
  readonly projectDirectory: string
  readonly allowedRoots: ResolvedAllowedRoots
  readonly homeDirectory?: string
}): ResolvedManifestPath {
  const sourcePath = decodePublicPath(input.referenceManifestPath)
  const resolvedPath = resolveFromProject(sourcePath, input.projectDirectory, input.homeDirectory ?? homedir())
  const canonicalPath = resolveAllowedRegularFile({
    sourcePath: input.referenceManifestPath,
    resolvedPath,
    allowedRoots: input.allowedRoots,
  })
  return { originalPath: input.referenceManifestPath, resolvedPath, canonicalPath }
}

export function resolveReferencePath(input: {
  readonly declaredPath: string
  readonly manifestDirectory: string
  readonly allowedRoots: ResolvedAllowedRoots
}): ResolvedReferencePath {
  if (isAbsolute(input.declaredPath) || input.declaredPath.startsWith("file://")) {
    throw new ReferenceManifestError("invalid_path", input.declaredPath)
  }
  const resolvedPath = resolve(input.manifestDirectory, input.declaredPath)
  const canonicalPath = resolveAllowedRegularFile({
    sourcePath: input.declaredPath,
    resolvedPath,
    allowedRoots: input.allowedRoots,
  })
  return { declaredPath: input.declaredPath, resolvedPath, canonicalPath }
}

function resolveAllowedRegularFile(input: {
  readonly sourcePath: string
  readonly resolvedPath: string
  readonly allowedRoots: ResolvedAllowedRoots
}): string {
  const canonicalPath = canonicalPathOrThrow(input.resolvedPath, input.sourcePath)
  if (!isInsideAllowedRoot(canonicalPath, input.allowedRoots)) {
    throw new ReferenceManifestError("outside_allowed_roots", input.sourcePath)
  }
  const stats = statsOrThrow(canonicalPath, input.sourcePath)
  if (!stats.isFile()) {
    throw new ReferenceManifestError("non_regular", input.sourcePath)
  }
  return canonicalPath
}

function decodePublicPath(referenceManifestPath: string): string {
  if (!referenceManifestPath.startsWith("file://")) return referenceManifestPath
  try {
    return decodeURIComponent(referenceManifestPath.slice("file://".length))
  } catch {
    throw new ReferenceManifestError("invalid_path", referenceManifestPath)
  }
}

function resolveFromProject(path: string, projectDirectory: string, homeDirectory: string): string {
  const expandedPath = path.startsWith("~/") ? resolve(homeDirectory, path.slice(2)) : path
  return isAbsolute(expandedPath) ? expandedPath : resolve(projectDirectory, expandedPath)
}

function canonicalPathOrThrow(resolvedPath: string, sourcePath: string): string {
  try {
    return realpathSync(resolvedPath)
  } catch (error) {
    throw new ReferenceManifestError(filesystemErrorCode(error), sourcePath)
  }
}

function statsOrThrow(canonicalPath: string, sourcePath: string): Stats {
  try {
    return statSync(canonicalPath)
  } catch (error) {
    throw new ReferenceManifestError(filesystemErrorCode(error), sourcePath)
  }
}

function filesystemErrorCode(error: unknown): "missing" | "unreadable" {
  return error instanceof Error && "code" in error && error.code === "ENOENT" ? "missing" : "unreadable"
}

function isInsideAllowedRoot(candidatePath: string, allowedRoots: ResolvedAllowedRoots): boolean {
  return allowedRoots.canonicalPaths.some((rootPath) => {
    const relativePath = relative(rootPath, candidatePath)
    return relativePath === "" || (!relativePath.startsWith(`..${sep}`) && relativePath !== ".." && !isAbsolute(relativePath))
  })
}
