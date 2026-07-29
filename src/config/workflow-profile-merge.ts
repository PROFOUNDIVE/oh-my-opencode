import type { OpenMathConfig } from "./schema"
import { deepMerge } from "../shared"

export function mergeOpenMathConfig(
  base: OpenMathConfig | undefined,
  override: OpenMathConfig | undefined,
): OpenMathConfig | undefined {
  const merged = deepMerge(base, override)
  if (!merged) return undefined

  return {
    ...merged,
    workflow_profiles: {
      ...(base?.workflow_profiles ?? {}),
      ...(override?.workflow_profiles ?? {}),
    },
  }
}
