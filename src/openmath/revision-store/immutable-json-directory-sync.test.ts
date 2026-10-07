import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { nodeStorageRuntime } from "../workflow/storage/node-storage-runtime"
import type { StorageFileHandle } from "../workflow/storage/storage-runtime-contract"
import { syncImmutableJsonRevisionDirectory } from "./immutable-json-directory-sync"

function fault(code: string): Error & { readonly code: string } {
  return Object.assign(new Error(`Injected ${code}`), { code })
}

function failingSyncHandle(handle: StorageFileHandle, code: string): StorageFileHandle {
  return {
    readFile: async () => handle.readFile(),
    writeFile: async (content) => handle.writeFile(content),
    identity: async () => handle.identity(),
    sync: async () => { throw fault(code) },
    close: async () => handle.close(),
  }
}

async function syncWithFault(platform: NodeJS.Platform, code: string) {
  const directory = await mkdtemp(join(tmpdir(), "openmath-directory-sync-"))
  try {
    const runtime = {
      ...nodeStorageRuntime,
      platform,
      open: async (path: string, flags: "r" | "wx") => failingSyncHandle(
        await nodeStorageRuntime.open(path, flags),
        code,
      ),
    }
    return await syncImmutableJsonRevisionDirectory(directory, runtime)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test("treats directory fsync EPERM as unsupported on Windows", async () => {
  // given
  const platform = "win32"

  // when
  const result = await syncWithFault(platform, "EPERM")

  // then
  expect(result).toEqual({ kind: "ok" })
})

test("preserves directory fsync EPERM as an error outside Windows", async () => {
  // given
  const platform = "linux"

  // when
  const result = await syncWithFault(platform, "EPERM")

  // then
  expect(result).toEqual({
    kind: "error",
    error_code: "STORAGE_WRITE_FAILED",
    reason: "RUN_DIRECTORY_SYNC_FAILED",
  })
})

test("preserves unexpected Windows directory fsync errors", async () => {
  // given
  const platform = "win32"

  // when
  const result = await syncWithFault(platform, "EIO")

  // then
  expect(result).toEqual({
    kind: "error",
    error_code: "STORAGE_WRITE_FAILED",
    reason: "RUN_DIRECTORY_SYNC_FAILED",
  })
})

test("preserves Windows directory open EPERM as an error", async () => {
  // given
  const runtime = {
    ...nodeStorageRuntime,
    platform: "win32" as const,
    open: async () => { throw fault("EPERM") },
  }

  // when
  const result = await syncImmutableJsonRevisionDirectory("unused", runtime)

  // then
  expect(result).toEqual({
    kind: "error",
    error_code: "STORAGE_WRITE_FAILED",
    reason: "RUN_DIRECTORY_OPEN_FAILED",
  })
})
