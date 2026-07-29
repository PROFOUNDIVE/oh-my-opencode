import { existsSync, readFileSync } from "node:fs"
import { decodeFileUri } from "./file-uri-decoder"

export function resolvePromptAppend(promptAppend: string, configDir?: string): string {
  if (!promptAppend.startsWith("file://")) return promptAppend

  let fileUri: ReturnType<typeof decodeFileUri>
  try {
    fileUri = decodeFileUri(promptAppend, configDir)
  } catch {
    return `[WARNING: Malformed file URI (invalid percent-encoding): ${promptAppend}]`
  }

  if (!existsSync(fileUri.path)) {
    return `[WARNING: Could not resolve file URI: ${promptAppend}]`
  }

  try {
    return readFileSync(fileUri.path, "utf8")
  } catch {
    return `[WARNING: Could not read file: ${promptAppend}]`
  }
}
