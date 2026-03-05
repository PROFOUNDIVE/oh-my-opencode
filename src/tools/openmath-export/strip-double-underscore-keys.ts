import { isPlainObject } from "./is-plain-object"

export function stripDoubleUnderscoreKeys<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripDoubleUnderscoreKeys(item)) as T
  }

  if (!isPlainObject(value)) {
    return value
  }

  const entries = Object.entries(value)
    .filter(([key]) => !key.startsWith("__"))
    .map(([key, v]) => [key, stripDoubleUnderscoreKeys(v)] as const)

  const rebuilt: Record<string, unknown> = {}
  for (const [key, v] of entries) {
    rebuilt[key] = v
  }
  return rebuilt as T
}
