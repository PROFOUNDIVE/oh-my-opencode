import { log } from "../shared"
import { OverridableAgentNameSchema } from "./schema/agent-names"

export function warnUnsupportedAgentKeys(
  rawAgents: Record<string, unknown> | undefined,
  configSource: string
): string[] {
  if (!rawAgents || typeof rawAgents !== "object") {
    return []
  }

  const validAgentNames = OverridableAgentNameSchema.options
  const validAgentNameSet = new Set<string>(validAgentNames)
  const validAgentNameLowerSet = new Set(validAgentNames.map((name) => name.toLowerCase()))
  const warnings: string[] = []

  for (const key of Object.keys(rawAgents)) {
    if (validAgentNameSet.has(key)) {
      continue
    }

    const normalizedKey = key.toLowerCase()
    if (validAgentNameLowerSet.has(normalizedKey)) {
      const canonicalName = validAgentNames.find((name) => name.toLowerCase() === normalizedKey)
      const warning = `Config warning: Agent key "${key}" has incorrect casing in ${configSource} config. Use "${canonicalName}".`
      warnings.push(warning)
      log(warning)
      continue
    }

    const warning = `Config warning: Unsupported agent key "${key}" in ${configSource} config. Did you mean one of: ${OverridableAgentNameSchema.options.join(", ")}?`
    warnings.push(warning)
    log(warning)
  }

  return warnings
}
