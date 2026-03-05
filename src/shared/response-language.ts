import type { OhMyOpenCodeConfig } from "../config"

export function resolveResponseLanguage(pluginConfig: OhMyOpenCodeConfig): string | undefined {
  const configured = pluginConfig.localization?.response_language
  if (!configured) return undefined
  if (configured === "auto") return undefined
  return configured
}
