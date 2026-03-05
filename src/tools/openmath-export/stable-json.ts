import { isPlainObject } from "./is-plain-object"

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep)
  }
  if (!isPlainObject(value)) {
    return value
  }

  const sortedKeys = Object.keys(value).sort((a, b) => a.localeCompare(b))
  const rebuilt: Record<string, unknown> = {}
  for (const key of sortedKeys) {
    rebuilt[key] = sortKeysDeep(value[key])
  }
  return rebuilt
}

export function stableJson(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value), null, 2)
}
