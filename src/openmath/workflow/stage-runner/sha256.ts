import { createHash } from "node:crypto"

export function sha256(value: string | Uint8Array): string {
  const hash = createHash("sha256")
  return (typeof value === "string" ? hash.update(value, "utf8") : hash.update(value)).digest("hex")
}
