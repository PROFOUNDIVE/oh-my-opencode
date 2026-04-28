import { join } from "node:path"

import { detectConfigFile } from "./jsonc-parser"

export const CURRENT_PLUGIN_PACKAGE_NAME = "oh-my-openmath"
export const LEGACY_PLUGIN_PACKAGE_NAMES = ["oh-my-opencode"] as const
export const ALL_PLUGIN_PACKAGE_NAMES = [
  CURRENT_PLUGIN_PACKAGE_NAME,
  ...LEGACY_PLUGIN_PACKAGE_NAMES,
] as const

export const CURRENT_PLUGIN_CONFIG_BASENAME = "oh-my-openmath"
export const LEGACY_PLUGIN_CONFIG_BASENAMES = ["oh-my-opencode"] as const
export const ALL_PLUGIN_CONFIG_BASENAMES = [
  CURRENT_PLUGIN_CONFIG_BASENAME,
  ...LEGACY_PLUGIN_CONFIG_BASENAMES,
] as const

export const PLUGIN_CACHE_DIR_NAME = "oh-my-openmath"
export const PLUGIN_LOG_FILE_NAME = "oh-my-openmath.log"

export function matchesPluginSpecifier(entry: string): boolean {
  return ALL_PLUGIN_PACKAGE_NAMES.some(
    (packageName) => entry === packageName || entry.startsWith(`${packageName}@`)
  )
}

export function detectPluginConfigFile(configDir: string): {
  format: "json" | "jsonc" | "none"
  path: string
} {
  for (const baseName of ALL_PLUGIN_CONFIG_BASENAMES) {
    const detected = detectConfigFile(join(configDir, baseName))
    if (detected.format !== "none") {
      return detected
    }
  }

  return {
    format: "none",
    path: join(configDir, `${CURRENT_PLUGIN_CONFIG_BASENAME}.json`),
  }
}
