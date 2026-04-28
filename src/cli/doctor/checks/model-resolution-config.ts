import { readFileSync } from "node:fs"
import { join } from "node:path"
import { detectPluginConfigFile, getOpenCodeConfigPaths, parseJsonc } from "../../../shared"
import type { OmoConfig } from "./model-resolution-types"

export function loadOmoConfig(): OmoConfig | null {
  const projectDetected = detectPluginConfigFile(join(process.cwd(), ".opencode"))
  if (projectDetected.format !== "none") {
    try {
      const content = readFileSync(projectDetected.path, "utf-8")
      return parseJsonc<OmoConfig>(content)
    } catch {
      return null
    }
  }

  const userDetected = detectPluginConfigFile(
    getOpenCodeConfigPaths({ binary: "opencode", version: null }).configDir
  )
  if (userDetected.format !== "none") {
    try {
      const content = readFileSync(userDetected.path, "utf-8")
      return parseJsonc<OmoConfig>(content)
    } catch {
      return null
    }
  }

  return null
}
