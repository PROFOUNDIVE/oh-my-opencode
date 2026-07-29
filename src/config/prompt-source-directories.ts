import type { OhMyOpenCodeConfig } from "./schema"

type PromptSourceField = "prompt" | "prompt_append"
type PromptSourceDirectories = Partial<Record<PromptSourceField, string>>

export type PromptSourceMetadata = {
  readonly originalUri: string
  readonly baseDirectory?: string
  readonly resolvedPath?: string
  readonly canonicalPath?: string
  readonly content: string
  readonly sha256?: string
}

const sourceDirectories = new WeakMap<object, PromptSourceDirectories>()
const sourceMetadata = new WeakMap<object, Partial<Record<PromptSourceField, readonly PromptSourceMetadata[]>>>()
const sourceFields: readonly PromptSourceField[] = ["prompt", "prompt_append"]

export function recordPromptSourceDirectories(
  config: OhMyOpenCodeConfig,
  directory: string,
): void {
  recordGroupDirectories(config.agents, directory)
  recordGroupDirectories(config.categories, directory)
}

export function mergePromptSourceDirectories(
  base: OhMyOpenCodeConfig,
  override: OhMyOpenCodeConfig,
  merged: OhMyOpenCodeConfig,
): void {
  mergeGroupDirectories(base.agents, override.agents, merged.agents)
  mergeGroupDirectories(base.categories, override.categories, merged.categories)
}

export function getPromptSourceDirectory(
  source: object | undefined,
  field: PromptSourceField,
): string | undefined {
  return source ? sourceDirectories.get(source)?.[field] : undefined
}

export function getPromptSourceMetadata(
  source: object | undefined,
  field: PromptSourceField,
): readonly PromptSourceMetadata[] {
  return sourceMetadata.get(source ?? {})?.[field] ?? []
}

export function setPromptSourceMetadata(
  source: object,
  field: PromptSourceField,
  metadata: readonly PromptSourceMetadata[],
): void {
  const current = sourceMetadata.get(source) ?? {}
  sourceMetadata.set(source, { ...current, [field]: metadata })
}

function recordGroupDirectories(group: object | undefined, directory: string): void {
  for (const source of Object.values(group ?? {})) {
    if (isObject(source)) recordSourceDirectories(source, directory)
  }
}

function mergeGroupDirectories(
  baseGroup: object | undefined,
  overrideGroup: object | undefined,
  mergedGroup: object | undefined,
): void {
  const names = new Set([
    ...Object.keys(baseGroup ?? {}),
    ...Object.keys(overrideGroup ?? {}),
  ])

  for (const name of names) {
    const mergedSource = getNamedSource(mergedGroup, name)
    if (!mergedSource) continue

    const baseSource = getNamedSource(baseGroup, name)
    const overrideSource = getNamedSource(overrideGroup, name)
    const directories: PromptSourceDirectories = {}

    for (const field of sourceFields) {
      const winningSource = hasStringField(overrideSource, field) ? overrideSource : baseSource
      const directory = getPromptSourceDirectory(winningSource, field)
      if (directory) directories[field] = directory
    }

    if (Object.keys(directories).length > 0) {
      sourceDirectories.set(mergedSource, directories)
    }
  }
}

function recordSourceDirectories(source: object, directory: string): void {
  const directories: PromptSourceDirectories = {}

  for (const field of sourceFields) {
    if (hasStringField(source, field)) directories[field] = directory
  }

  if (Object.keys(directories).length > 0) {
    sourceDirectories.set(source, directories)
  }
}

function getNamedSource(group: object | undefined, name: string): object | undefined {
  const source = Object.entries(group ?? {}).find(([candidate]) => candidate === name)?.[1]
  return isObject(source) ? source : undefined
}

function hasStringField(source: object | undefined, field: PromptSourceField): boolean {
  return Object.entries(source ?? {}).some(([key, value]) => key === field && typeof value === "string")
}

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null
}
