import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import { getWorkflowRunDirectory } from "./run-directory-hash"
import { formatWorkflowRevisionFilename, getWorkflowRevisionPath } from "./revision-filename"

describe("workflow storage paths", () => {
  test("hashes the exact UTF-8 run ID into a lowercase SHA-256 directory", () => {
    // given
    const projectDirectory = "/project"

    // when
    const runDirectory = getWorkflowRunDirectory(projectDirectory, "run-한글")

    // then
    expect(runDirectory).toBe(join(
      projectDirectory,
      ".sisyphus",
      "openmath-workflows",
      "f89886eededecec6698b471cb8525fff5f5e9f49ba15b93f1c960bfeb063115b",
    ))
  })

  test("formats immutable revisions with exactly twelve decimal digits", () => {
    // when
    const filenames = [0, 42, 999_999_999_999].map(formatWorkflowRevisionFilename)

    // then
    expect(filenames).toEqual([
      "state.rev-000000000000.json",
      "state.rev-000000000042.json",
      "state.rev-999999999999.json",
    ])
    expect(getWorkflowRevisionPath("/run", 7)).toBe(join("/run", "state.rev-000000000007.json"))
  })
})
