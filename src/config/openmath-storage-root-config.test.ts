/// <reference types="bun-types" />

import { expect, test } from "bun:test"

import { OpenMathConfigSchema } from "./schema"

test("retains an explicitly configured local OpenMath storage root", () => {
  // given
  const storageRoot = "C:/Users/student/AppData/Local/OpenMath/state"

  // when
  const result = OpenMathConfigSchema.parse({ storage_root: storageRoot })

  // then
  expect(result).toMatchObject({ storage_root: storageRoot })
})

test.each(["", "   ", "state\0invalid"])("rejects unusable storage root %j", (storageRoot) => {
  // given
  const input = { storage_root: storageRoot }

  // when
  const result = OpenMathConfigSchema.safeParse(input)

  // then
  expect(result.success).toBe(false)
})
