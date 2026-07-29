import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { z } from "zod"

import { nodeStorageRuntime } from "./node-storage-runtime"
import { acquireWorkflowWriteLock, releaseWorkflowWriteLock } from "./write-lock"

describe("workflow write lock record", () => {
  let runDirectory: string

  beforeEach(() => {
    runDirectory = mkdtempSync(join(tmpdir(), "openmath-workflow-lock-record-"))
  })

  afterEach(() => {
    rmSync(runDirectory, { recursive: true, force: true })
  })

  test("stores only token, pid, and started_at after exclusive acquisition", async () => {
    // when
    const acquired = await acquireWorkflowWriteLock({ run_directory: runDirectory, timeout_ms: 0 })

    // then
    expect(acquired.kind).toBe("acquired")
    if (acquired.kind === "error") return
    const record = z.object({
      token: z.string(),
      pid: z.number(),
      started_at: z.string(),
    }).strict().parse(JSON.parse(readFileSync(join(runDirectory, ".write.lock"), "utf8")))
    expect(Object.keys(record).sort()).toEqual(["pid", "started_at", "token"])
    expect(record).toMatchObject({ token: acquired.token, pid: nodeStorageRuntime.pid })
    expect(Number.isNaN(Date.parse(record.started_at))).toBe(false)
    await releaseWorkflowWriteLock({ run_directory: runDirectory, token: acquired.token })
  })
})
