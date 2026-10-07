/// <reference types="bun-types" />

import { afterEach, beforeEach, expect, spyOn, test } from "bun:test"
import { mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import * as logger from "../../shared/logger"
import { nodeStorageRuntime } from "../workflow/storage/node-storage-runtime"
import { startWorkflowState } from "../workflow/storage/start-reservation"
import { getWorkflowRunDirectory } from "../workflow/storage/run-directory-hash"
import { createStoredWorkflowState } from "../workflow/storage/storage-test-state"
import type { StorageRuntime } from "../workflow/storage/storage-runtime-contract"
import { writeImmutableJsonRevision } from "./immutable-json-revision-writer"

let directory: string

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "openmath-ownership-failure-"))
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

function fault(code: string, syscall: string, errno: number) {
  return Object.assign(new Error(`Injected ${code}`), { code, syscall, errno })
}

test.each([-4068, -21])("fails closed on ownership-link EISDIR with errno %i", async (errno) => {
  // given
  const state = createStoredWorkflowState("APT_MIDTERM::1", 0)
  const runtime: StorageRuntime = {
    ...nodeStorageRuntime,
    platform: "win32",
    link: async () => { throw fault("EISDIR", "link", errno) },
  }

  // when
  const result = await startWorkflowState({ directory, state }, runtime)

  // then
  expect(result).toEqual({
    kind: "error",
    error_code: "STORAGE_ATOMICITY_UNAVAILABLE",
    message: "Ownership-bound temp creation is unavailable",
  })
  expect(await readdir(getWorkflowRunDirectory(directory, state.run_id))).toEqual([])
})

test.each([
  { code: "EISDIR", errno: -4068, expected: { kind: "error", error_code: "STORAGE_ATOMICITY_UNAVAILABLE", reason: "OWNERSHIP_BOUND_TEMP_CREATE_UNAVAILABLE" } },
  { code: "EIO", errno: -5, expected: { kind: "error", error_code: "STORAGE_WRITE_FAILED", reason: "TEMP_OWNERSHIP_BIND_FAILED" } },
] as const)("diagnoses an ownership-link $code failure without publishing", async ({ code, errno, expected }) => {
  // given
  const logSpy = spyOn(logger, "log")
  const runtime: StorageRuntime = {
    ...nodeStorageRuntime,
    platform: "win32",
    link: async () => { throw fault(code, "link", errno) },
  }
  try {
    // when
    const result = await writeImmutableJsonRevision({
      run_directory: directory,
      build_revision_path: () => join(directory, "revision.json"),
      serialized_bytes: "{}",
    }, runtime)

    // then
    expect(result).toEqual(expected)
    expect(logSpy).toHaveBeenCalledWith("[openmath] Immutable temp ownership binding failed", {
      operation: "TEMP_OWNER_LINK_FAILED",
      platform: "win32",
      code,
      errno,
      syscall: "link",
    })
    expect(await readdir(directory)).toEqual([])
  } finally {
    logSpy.mockRestore()
  }
})

test.each([
  { owner: false, operation: "TEMP_IDENTITY_CHECK_FAILED" },
  { owner: true, operation: "OWNER_IDENTITY_CHECK_FAILED" },
])("distinguishes $operation EISDIR from a hard-link capability failure", async ({ owner, operation }) => {
  // given
  const logSpy = spyOn(logger, "log")
  let injected = false
  const runtime: StorageRuntime = {
    ...nodeStorageRuntime,
    sameIdentity: async (path, identity) => {
      if (!injected && path.endsWith(".owner") === owner) {
        injected = true
        throw fault("EISDIR", "stat", -21)
      }
      return nodeStorageRuntime.sameIdentity(path, identity)
    },
  }
  try {
    // when
    const result = await writeImmutableJsonRevision({
      run_directory: directory,
      build_revision_path: () => join(directory, "revision.json"),
      serialized_bytes: "{}",
    }, runtime)

    // then
    expect(result).toEqual({ kind: "error", error_code: "STORAGE_WRITE_FAILED", reason: "TEMP_OWNERSHIP_BIND_FAILED" })
    expect(logSpy).toHaveBeenCalledWith("[openmath] Immutable temp ownership binding failed", {
      operation,
      platform: process.platform,
      code: "EISDIR",
      errno: -21,
      syscall: "stat",
    })
    expect(await readdir(directory)).toEqual([])
  } finally {
    logSpy.mockRestore()
  }
})

test("keeps exclusive temp creation EISDIR a write failure", async () => {
  // given
  const runtime: StorageRuntime = {
    ...nodeStorageRuntime,
    open: async () => { throw fault("EISDIR", "open", -21) },
  }

  // when
  const result = await writeImmutableJsonRevision({
    run_directory: directory,
    build_revision_path: () => join(directory, "revision.json"),
    serialized_bytes: "{}",
  }, runtime)

  // then
  expect(result).toEqual({ kind: "error", error_code: "STORAGE_WRITE_FAILED", reason: "TEMP_CREATE_FAILED" })
  expect(await readdir(directory)).toEqual([])
})
