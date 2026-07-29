import { homedir } from "node:os"
import { isAbsolute, resolve } from "node:path"

export type DecodedFileUri = {
  readonly uri: string
  readonly path: string
}

export function decodeFileUri(fileUri: string, configDir?: string): DecodedFileUri {
  if (!fileUri.startsWith("file://")) throw new TypeError("Expected a file URI")

  const decoded = decodeURIComponent(fileUri.slice(7))
  const expanded = decoded.startsWith("~/") ? decoded.replace(/^~\//, `${homedir()}/`) : decoded

  return {
    uri: fileUri,
    path: isAbsolute(expanded) ? expanded : resolve(configDir ?? process.cwd(), expanded),
  }
}
