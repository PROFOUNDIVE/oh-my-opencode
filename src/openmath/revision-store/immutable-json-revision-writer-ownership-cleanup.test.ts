import { expect, test } from "bun:test"
import { mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { nodeStorageRuntime } from "../workflow/storage/node-storage-runtime"
import type { StorageRuntime } from "../workflow/storage/storage-runtime-contract"
import { writeImmutableJsonRevision } from "./immutable-json-revision-writer"

async function withRunDirectory(run: (runDirectory: string) => Promise<void>): Promise<void> {
  const runDirectory = await mkdtemp(join(tmpdir(), "openmath-immutable-owner-cleanup-"))
  try {
    await run(runDirectory)
  } finally {
    await rm(runDirectory, { recursive: true, force: true })
  }
}

test("removes the exclusive temp when its initial identity check fails", async () => {
  await withRunDirectory(async (runDirectory) => {
    // given
    let firstCheck = true
    const runtime: StorageRuntime = {
      ...nodeStorageRuntime,
      sameIdentity: async (path, identity) => {
        if (firstCheck) {
          firstCheck = false
          return false
        }
        return nodeStorageRuntime.sameIdentity(path, identity)
      },
    }

    // when
    const result = await writeImmutableJsonRevision({
      run_directory: runDirectory,
      build_revision_path: () => join(runDirectory, "revision.json"),
      serialized_bytes: "{}",
    }, runtime)

    // then
    expect(result).toMatchObject({ kind: "error", reason: "EXCLUSIVE_TEMP_IDENTITY_CHANGED" })
    expect(await readdir(runDirectory)).toEqual([])
  })
})

test("removes both ownership links when owner binding identity mismatches", async () => {
  await withRunDirectory(async (runDirectory) => {
    // given
    let ownerCheck = true
    const runtime: StorageRuntime = {
      ...nodeStorageRuntime,
      sameIdentity: async (path, identity) => {
        if (path.endsWith(".owner") && ownerCheck) {
          ownerCheck = false
          return false
        }
        return nodeStorageRuntime.sameIdentity(path, identity)
      },
    }

    // when
    const result = await writeImmutableJsonRevision({
      run_directory: runDirectory,
      build_revision_path: () => join(runDirectory, "revision.json"),
      serialized_bytes: "{}",
    }, runtime)

    // then
    expect(result).toMatchObject({ kind: "error", reason: "TEMP_OWNERSHIP_BINDING_CHANGED" })
    expect(await readdir(runDirectory)).toEqual([])
  })
})
