import { expect, test } from "bun:test"
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { writeImmutableJsonRevision } from "./immutable-json-revision-writer"

test("publishes the provided serialized bytes without changing them", async () => {
  // given
  const runDirectory = await mkdtemp(join(tmpdir(), "openmath-immutable-json-revision-"))
  const revisionPath = join(runDirectory, "revision.json")
  const serializedBytes = "{\n  \"revision\": 4\n}\n"

  try {
    // when
    const result = await writeImmutableJsonRevision({
      run_directory: runDirectory,
      build_revision_path: () => revisionPath,
      serialized_bytes: serializedBytes,
    })

    // then
    expect(result).toEqual({ kind: "ok" })
    expect(await readFile(revisionPath, "utf8")).toBe(serializedBytes)
    expect((await readdir(runDirectory)).filter((name) => name.startsWith(".tmp-"))).toEqual([])
  } finally {
    await rm(runDirectory, { recursive: true, force: true })
  }
})

test("treats already-serialized bytes as opaque", async () => {
  // given
  const runDirectory = await mkdtemp(join(tmpdir(), "openmath-immutable-json-revision-"))
  const revisionPath = join(runDirectory, "opaque.json")
  const serializedBytes = "{not-valid-json"

  try {
    // when
    const result = await writeImmutableJsonRevision({
      run_directory: runDirectory,
      build_revision_path: () => revisionPath,
      serialized_bytes: serializedBytes,
    })

    // then
    expect(result).toEqual({ kind: "ok" })
    expect(await readFile(revisionPath, "utf8")).toBe(serializedBytes)
  } finally {
    await rm(runDirectory, { recursive: true, force: true })
  }
})

test("fails before creating a temp when the revision path builder rejects its input", async () => {
  // given
  const runDirectory = await mkdtemp(join(tmpdir(), "openmath-immutable-json-revision-"))
  const buildRevisionPath = () => {
    throw new RangeError("invalid revision path")
  }

  try {
    // when
    const writing = writeImmutableJsonRevision({
      run_directory: runDirectory,
      build_revision_path: buildRevisionPath,
      serialized_bytes: "{}",
    })

    // then
    expect(writing).rejects.toThrow("invalid revision path")
    expect(await readdir(runDirectory)).toEqual([])
  } finally {
    await rm(runDirectory, { recursive: true, force: true })
  }
})
