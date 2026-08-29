import { expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"

import { nodeStorageRuntime } from "../workflow/storage/node-storage-runtime"
import type { StorageFileHandle, StorageRuntime } from "../workflow/storage/storage-runtime-contract"
import { writeImmutableJsonRevision } from "./immutable-json-revision-writer"

function fault(code: string): Error & { readonly code: string } {
  return Object.assign(new Error(`Injected ${code}`), { code })
}

async function withRunDirectory(run: (runDirectory: string) => Promise<void>): Promise<void> {
  const runDirectory = await mkdtemp(join(tmpdir(), "openmath-immutable-json-failure-"))
  try {
    await run(runDirectory)
  } finally {
    await rm(runDirectory, { recursive: true, force: true })
  }
}

function failingSyncHandle(handle: StorageFileHandle): StorageFileHandle {
  return {
    readFile: async () => handle.readFile(),
    writeFile: async (content) => handle.writeFile(content),
    identity: async () => handle.identity(),
    sync: async () => { throw fault("EIO") },
    close: async () => handle.close(),
  }
}

function partialWriteHandle(handle: StorageFileHandle): StorageFileHandle {
  return {
    readFile: async () => handle.readFile(),
    writeFile: async (content) => {
      await handle.writeFile(content.slice(0, 3))
      throw fault("EIO")
    },
    identity: async () => handle.identity(),
    sync: async () => handle.sync(),
    close: async () => handle.close(),
  }
}

test("fails closed when exclusive temp creation is unavailable", async () => {
  await withRunDirectory(async (runDirectory) => {
    // given
    const revisionPath = join(runDirectory, "revision.json")
    const runtime: StorageRuntime = {
      ...nodeStorageRuntime,
      open: async (path, flags) => flags === "wx" ? Promise.reject(fault("ENOTSUP")) : nodeStorageRuntime.open(path, flags),
    }

    // when
    const result = await writeImmutableJsonRevision({
      run_directory: runDirectory,
      build_revision_path: () => revisionPath,
      serialized_bytes: "{}",
    }, runtime)

    // then
    expect(result).toEqual({
      kind: "error",
      error_code: "STORAGE_ATOMICITY_UNAVAILABLE",
      reason: "EXCLUSIVE_TEMP_CREATE_UNAVAILABLE",
    })
    expect(existsSync(revisionPath)).toBe(false)
    expect(await readdir(runDirectory)).toEqual([])
  })
})

test("cleans owned temps when ownership drifts before publication", async () => {
  await withRunDirectory(async (runDirectory) => {
    // given
    const revisionPath = join(runDirectory, "revision.json")
    let ownerChecks = 0
    const runtime: StorageRuntime = {
      ...nodeStorageRuntime,
      sameIdentity: async (path, identity) => {
        if (path.endsWith(".owner") && ++ownerChecks === 2) return false
        return nodeStorageRuntime.sameIdentity(path, identity)
      },
    }

    // when
    const result = await writeImmutableJsonRevision({
      run_directory: runDirectory,
      build_revision_path: () => revisionPath,
      serialized_bytes: "{}",
    }, runtime)

    // then
    expect(result).toEqual({
      kind: "error",
      error_code: "STORAGE_WRITE_FAILED",
      reason: "TEMP_OWNERSHIP_CHANGED_BEFORE_PUBLICATION",
    })
    expect(existsSync(revisionPath)).toBe(false)
    expect((await readdir(runDirectory)).filter((name) => name.startsWith(".tmp-"))).toEqual([])
  })
})

test("does not replace an existing revision and cleans owned temps", async () => {
  await withRunDirectory(async (runDirectory) => {
    // given
    const revisionPath = join(runDirectory, "revision.json")
    const first = await writeImmutableJsonRevision({
      run_directory: runDirectory,
      build_revision_path: () => revisionPath,
      serialized_bytes: "existing",
    })
    expect(first).toEqual({ kind: "ok" })

    // when
    const result = await writeImmutableJsonRevision({
      run_directory: runDirectory,
      build_revision_path: () => revisionPath,
      serialized_bytes: "replacement",
    })

    // then
    expect(result).toEqual({
      kind: "error",
      error_code: "STORAGE_WRITE_FAILED",
      reason: "REVISION_ALREADY_ALLOCATED",
    })
    expect(await readFile(revisionPath, "utf8")).toBe("existing")
    expect((await readdir(runDirectory)).filter((name) => name.startsWith(".tmp-"))).toEqual([])
  })
})

test("removes partial writes when writing fails", async () => {
  await withRunDirectory(async (runDirectory) => {
    // given
    const revisionPath = join(runDirectory, "revision.json")
    const runtime: StorageRuntime = {
      ...nodeStorageRuntime,
      open: async (path, flags) => {
        const handle = await nodeStorageRuntime.open(path, flags)
        return flags === "wx" ? partialWriteHandle(handle) : handle
      },
    }

    // when
    const result = await writeImmutableJsonRevision({
      run_directory: runDirectory,
      build_revision_path: () => revisionPath,
      serialized_bytes: "partial",
    }, runtime)

    // then
    expect(result).toEqual({
      kind: "error",
      error_code: "STORAGE_WRITE_FAILED",
      reason: "DURABLE_TEMP_WRITE_FAILED",
    })
    expect(existsSync(revisionPath)).toBe(false)
    expect(await readdir(runDirectory)).toEqual([])
  })
})

test("removes partial writes when file fsync fails", async () => {
  await withRunDirectory(async (runDirectory) => {
    // given
    const revisionPath = join(runDirectory, "revision.json")
    const runtime: StorageRuntime = {
      ...nodeStorageRuntime,
      open: async (path, flags) => {
        const handle = await nodeStorageRuntime.open(path, flags)
        return flags === "wx" && basename(path).startsWith(".tmp-") ? failingSyncHandle(handle) : handle
      },
    }

    // when
    const result = await writeImmutableJsonRevision({
      run_directory: runDirectory,
      build_revision_path: () => revisionPath,
      serialized_bytes: "partial",
    }, runtime)

    // then
    expect(result).toEqual({
      kind: "error",
      error_code: "STORAGE_WRITE_FAILED",
      reason: "DURABLE_TEMP_WRITE_FAILED",
    })
    expect(existsSync(revisionPath)).toBe(false)
    expect(await readdir(runDirectory)).toEqual([])
  })
})

if (process.env.TASK_4_FAILURE_PROBE === "exclusive-create") {
  test("records a nonzero producer exit for the exclusive-create failure probe", async () => {
    await withRunDirectory(async (runDirectory) => {
      const runtime: StorageRuntime = {
        ...nodeStorageRuntime,
        open: async (path, flags) => flags === "wx" ? Promise.reject(fault("ENOTSUP")) : nodeStorageRuntime.open(path, flags),
      }
      const result = await writeImmutableJsonRevision({
        run_directory: runDirectory,
        build_revision_path: () => join(runDirectory, "revision.json"),
        serialized_bytes: "{}",
      }, runtime)
      expect(result).toEqual({ kind: "ok" })
    })
  })
}
