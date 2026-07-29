import { expect } from "bun:test"
import { existsSync, writeFileSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { z } from "zod"

import type { StorageRaceRequest } from "./race-request"

const RaceOutputSchema = z.object({
  kind: z.enum(["ok", "error"]),
  error_code: z.string().optional(),
  current_state_revision: z.number().optional(),
  state: z.object({ state_revision: z.number() }).passthrough().optional(),
}).passthrough()

export async function runStorageRace(directory: string, requests: readonly StorageRaceRequest[]) {
  const goPath = join(directory, "race.go")
  const workerPath = join(import.meta.dir, "race-worker.ts")
  const workers = requests.map((request, index) => {
    const requestPath = join(directory, `request-${index}.json`)
    const readyPath = join(directory, `ready-${index}`)
    const outputPath = join(directory, `output-${index}.json`)
    writeFileSync(requestPath, JSON.stringify(request), "utf8")
    const child = Bun.spawn({
      cmd: [process.execPath, workerPath, requestPath, readyPath, goPath, outputPath],
      stdout: "pipe",
      stderr: "pipe",
    })
    return { child, readyPath, outputPath }
  })

  const deadline = Date.now() + 5_000
  while (workers.some(({ readyPath }) => !existsSync(readyPath)) && Date.now() < deadline) await Bun.sleep(5)
  expect(workers.every(({ readyPath }) => existsSync(readyPath))).toBe(true)
  writeFileSync(goPath, "go", "utf8")
  const exitCodes = await Promise.all(workers.map(({ child }) => child.exited))
  expect(exitCodes).toEqual(requests.map(() => 0))

  return Promise.all(workers.map(async ({ outputPath }) => (
    RaceOutputSchema.parse(JSON.parse(await readFile(outputPath, "utf8")))
  )))
}
