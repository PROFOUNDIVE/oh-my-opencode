import { createHash } from "node:crypto"
import { realpathSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"

export function getOpenMathStorageDirectory(projectDirectory: string, configuredRoot?: string): string {
  if (configuredRoot === undefined) return projectDirectory
  const expandedRoot = configuredRoot === "~"
    ? homedir()
    : configuredRoot.startsWith("~/") || configuredRoot.startsWith("~\\")
      ? join(homedir(), configuredRoot.slice(2))
      : configuredRoot
  const projectIdentity = realpathSync(projectDirectory)
  const projectHash = createHash("sha256").update(projectIdentity, "utf8").digest("hex")
  return join(resolve(projectIdentity, expandedRoot), projectHash)
}
