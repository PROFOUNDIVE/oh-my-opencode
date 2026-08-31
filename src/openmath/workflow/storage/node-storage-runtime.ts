import { randomUUID } from "node:crypto"
import { link, mkdir, open, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises"

import type { StorageRuntime } from "./storage-runtime-contract"

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined
  return typeof error.code === "string" ? error.code : undefined
}

export const nodeStorageRuntime: StorageRuntime = {
  mkdir: async (path) => {
    await mkdir(path, { recursive: true })
  },
  readdir: async (path) => readdir(path),
  readFile: async (path) => readFile(path, "utf8"),
  readBytes: async (path) => readFile(path),
  writeExclusive: async (path, content) => {
    await writeFile(path, content, { encoding: "utf8", flag: "wx" })
  },
  open: async (path, flags) => {
    const handle = await open(path, flags)
    return {
      writeFile: async (content) => handle.writeFile(content),
      readFile: async () => handle.readFile("utf8"),
      identity: async () => {
        const value = await handle.stat()
        return { dev: value.dev, ino: value.ino }
      },
      sync: async () => handle.sync(),
      close: async () => handle.close(),
    }
  },
  link: async (source, destination) => link(source, destination),
  rename: async (source, destination) => rename(source, destination),
  unlink: async (path) => unlink(path),
  sameIdentity: async (path, identity) => {
    const value = await stat(path)
    return identity.dev !== 0 && identity.ino !== 0 && value.dev === identity.dev && value.ino === identity.ino
  },
  now: () => Date.now(),
  sleep: async (milliseconds) => Bun.sleep(milliseconds),
  token: () => randomUUID(),
  pid: process.pid,
  processStatus: (pid) => {
    try {
      process.kill(pid, 0)
      return "live"
    } catch (error) {
      return errorCode(error) === "ESRCH" ? "dead" : "unverifiable"
    }
  },
}
