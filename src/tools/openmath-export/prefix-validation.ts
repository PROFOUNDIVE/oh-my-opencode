import path from "node:path"

export function validatePrefix(prefix: string): { ok: true } | { ok: false; error_code: string; message: string } {
  if (prefix.length === 0) {
    return { ok: false, error_code: "INVALID_PREFIX", message: "prefix must be non-empty" }
  }

  if (prefix.includes("\u0000")) {
    return { ok: false, error_code: "INVALID_PREFIX", message: "prefix must not contain NUL" }
  }

  if (prefix.includes("/") || prefix.includes("\\") || prefix.includes(path.sep)) {
    return { ok: false, error_code: "INVALID_PREFIX", message: "prefix must not contain path separators" }
  }

  return { ok: true }
}
