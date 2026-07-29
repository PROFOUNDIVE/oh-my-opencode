import { extname } from "node:path"
import yaml from "js-yaml"
import { parse as parseJsonc, type ParseError } from "jsonc-parser"
import { ReferenceManifestV1Schema } from "./schema"
import { ReferenceManifestError, type ReferenceManifestV1 } from "./types"

export function parseReferenceManifest(input: {
  readonly content: string
  readonly manifestPath: string
}): ReferenceManifestV1 {
  const parsed = parseManifestDocument(input)
  const schemaResult = ReferenceManifestV1Schema.safeParse(parsed)
  if (!schemaResult.success) {
    throw new ReferenceManifestError("invalid_schema", input.manifestPath)
  }

  const ids = new Set<string>()
  for (const reference of schemaResult.data.references) {
    if (ids.has(reference.id)) {
      throw new ReferenceManifestError("duplicate_id", input.manifestPath)
    }
    ids.add(reference.id)
  }

  return {
    version: 1,
    references: schemaResult.data.references.map((reference) => ({
      id: reference.id,
      path: reference.path,
      role: reference.role,
      stages: [...reference.stages],
      required: reference.required,
    })),
  }
}

function parseManifestDocument(input: {
  readonly content: string
  readonly manifestPath: string
}): unknown {
  const extension = extname(input.manifestPath).toLowerCase()
  if (extension === ".yaml" || extension === ".yml") {
    try {
      return yaml.load(input.content, { schema: yaml.JSON_SCHEMA })
    } catch {
      throw new ReferenceManifestError("invalid_syntax", input.manifestPath)
    }
  }
  if (extension === ".json" || extension === ".jsonc") {
    return parseJsoncDocument(input)
  }
  throw new ReferenceManifestError("unsupported_extension", input.manifestPath)
}

function parseJsoncDocument(input: {
  readonly content: string
  readonly manifestPath: string
}): unknown {
  const errors: ParseError[] = []
  const parsed: unknown = parseJsonc(input.content, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  })
  if (errors.length > 0) {
    throw new ReferenceManifestError("invalid_syntax", input.manifestPath)
  }
  return parsed
}
