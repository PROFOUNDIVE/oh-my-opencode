import { expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { writeImmutableWorkflowRevision } from "./atomic-writer"
import { nodeStorageRuntime } from "./node-storage-runtime"
import { getWorkflowRevisionPath } from "./revision-filename"
import type { StorageFileHandle, StorageRuntime } from "./storage-runtime-contract"
import { createStoredWorkflowState } from "./storage-test-state"

function fault(code: string): Error & { readonly code: string } {
  return Object.assign(new Error(`Injected ${code}`), { code })
}

async function withRunDirectory(run: (runDirectory: string) => Promise<void>): Promise<void> {
  const runDirectory = await mkdtemp(join(tmpdir(), "openmath-workflow-writer-"))
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

test("preserves the exclusive-create failure code and message", async () => {
  await withRunDirectory(async (runDirectory) => {
    // given
    const state = createStoredWorkflowState("exclusive-create-message", 0)
    const runtime: StorageRuntime = {
      ...nodeStorageRuntime,
      open: async (path, flags) => flags === "wx" ? Promise.reject(fault("ENOTSUP")) : nodeStorageRuntime.open(path, flags),
    }

    // when
    const result = await writeImmutableWorkflowRevision({ run_directory: runDirectory, revision: 0, state }, runtime)

    // then
    expect(result).toEqual({
      kind: "error",
      error_code: "STORAGE_ATOMICITY_UNAVAILABLE",
      message: "Exclusive temp creation is unavailable",
    })
    expect(await readdir(runDirectory)).toEqual([])
  })
})

test("preserves the ownership-drift failure code and message", async () => {
  await withRunDirectory(async (runDirectory) => {
    // given
    const state = createStoredWorkflowState("ownership-drift-message", 0)
    let ownerChecks = 0
    const runtime: StorageRuntime = {
      ...nodeStorageRuntime,
      sameIdentity: async (path, identity) => {
        if (path.endsWith(".owner") && ++ownerChecks === 2) return false
        return nodeStorageRuntime.sameIdentity(path, identity)
      },
    }

    // when
    const result = await writeImmutableWorkflowRevision({ run_directory: runDirectory, revision: 0, state }, runtime)

    // then
    expect(result).toEqual({
      kind: "error",
      error_code: "STORAGE_WRITE_FAILED",
      message: "Workflow temp ownership changed before publication",
    })
    expect(existsSync(getWorkflowRevisionPath(runDirectory, 0))).toBe(false)
    expect((await readdir(runDirectory)).filter((name) => name.startsWith(".tmp-"))).toEqual([])
  })
})

test("preserves the existing-revision failure code and message", async () => {
  await withRunDirectory(async (runDirectory) => {
    // given
    const state = createStoredWorkflowState("existing-revision-message", 0)
    const revisionPath = getWorkflowRevisionPath(runDirectory, 0)
    await writeFile(revisionPath, "existing", "utf8")

    // when
    const result = await writeImmutableWorkflowRevision({ run_directory: runDirectory, revision: 0, state })

    // then
    expect(result).toEqual({
      kind: "error",
      error_code: "STORAGE_WRITE_FAILED",
      message: "Workflow revision is already allocated",
    })
    expect((await readdir(runDirectory)).filter((name) => name.startsWith(".tmp-"))).toEqual([])
  })
})

test("preserves the file-fsync failure code and message", async () => {
  await withRunDirectory(async (runDirectory) => {
    // given
    const state = createStoredWorkflowState("fsync-message", 0)
    const runtime: StorageRuntime = {
      ...nodeStorageRuntime,
      open: async (path, flags) => {
        const handle = await nodeStorageRuntime.open(path, flags)
        return flags === "wx" ? failingSyncHandle(handle) : handle
      },
    }

    // when
    const result = await writeImmutableWorkflowRevision({ run_directory: runDirectory, revision: 0, state }, runtime)

    // then
    expect(result).toEqual({
      kind: "error",
      error_code: "STORAGE_WRITE_FAILED",
      message: "Unable to durably write workflow temp file",
    })
    expect(existsSync(getWorkflowRevisionPath(runDirectory, 0))).toBe(false)
    expect(await readdir(runDirectory)).toEqual([])
  })
})
