import { existsSync } from "node:fs"
import { readFile, writeFile } from "node:fs/promises"

import { compareAndSwapWorkflowState } from "./compare-and-swap"
import { StorageRaceRequestSchema } from "./race-request"
import { startWorkflowState } from "./start-reservation"

const requestPath = Bun.argv[2]
const readyPath = Bun.argv[3]
const goPath = Bun.argv[4]
const outputPath = Bun.argv[5]
if (!requestPath || !readyPath || !goPath || !outputPath) {
  throw new TypeError("Storage race worker requires request, ready, go, and output paths")
}

const request = StorageRaceRequestSchema.parse(JSON.parse(await readFile(requestPath, "utf8")))
await writeFile(readyPath, "ready", "utf8")
while (!existsSync(goPath)) await Bun.sleep(5)

let result
switch (request.operation) {
  case "start":
    result = await startWorkflowState({ directory: request.directory, state: request.state })
    break
  case "cas":
    result = await compareAndSwapWorkflowState({
      directory: request.directory,
      run_id: request.run_id,
      expected_state_revision: request.expected_state_revision,
      next_state: request.next_state,
    })
    break
  default:
    request satisfies never
    throw new TypeError("Unsupported storage race operation")
}
await writeFile(outputPath, JSON.stringify(result), "utf8")
