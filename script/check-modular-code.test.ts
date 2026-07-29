import { afterEach, describe, expect, test } from "bun:test"

import { checkChangedFile, removeFixtureDirectories, type CheckerFixtureDirectories } from "./check-modular-code-fixtures"

const directories: CheckerFixtureDirectories = []

afterEach(() => removeFixtureDirectories(directories))

function expectRejected(path: string, contents: string, message: string): void {
  const result = checkChangedFile(directories, path, contents)
  expect(result.exitCode).not.toBe(0)
  expect(result.output).toContain(message)
}

function expectAccepted(path: string, contents: string): void {
  const result = checkChangedFile(directories, path, contents)
  expect(result.exitCode).toBe(0)
  expect(result.output).toContain("Modular code check passed")
}

describe("check-modular-code policy", () => {
  test("rejects a changed TypeScript file with 201 logic lines", () => {
    const source = Array.from({ length: 201 }, (_, index) => `export const value${index} = ${index}`).join("\n")
    expectRejected("src/policy.ts", source, "201 logic LOC")
  })

  test.each(["utils.ts", "helpers.ts", "service.ts", "common.ts"])("rejects the catch-all filename %s", (filename) => {
    expectRejected(`src/${filename}`, "export const value = 1\n", "catch-all filename")
  })

  test.each(["utils", "helpers", "service", "common"])("rejects the catch-all TSX basename %s", (name) => {
    expectRejected(`src/${name}.tsx`, "export const view = <main />\n", "catch-all filename")
  })

  test("rejects business logic in a changed index.ts", () => {
    expectRejected("src/index.ts", "export function calculate(value: number) { return value * 2 }\n", "business logic in index.ts")
  })

  test("permits callback-based index wiring", () => {
    const source = ['import { register } from "./register"', 'import { createTool } from "./tool"', "register({ create: () => createTool() })"].join("\n")
    expectAccepted("src/index.ts", source)
  })

  test.each([
    ["calculation", "export const total = price * quantity\n"],
    ["control flow", "if (enabled) register()\n"],
    ["function implementation", "export function calculate() { return price * quantity }\n"],
  ])("rejects index business logic: %s", (_, source) => {
    expectRejected("src/index.ts", source, "business logic in index.ts")
  })

  test("rejects an as any assertion in changed TypeScript", () => {
    expectRejected("src/policy.ts", "const value = input as any\n", "as any")
  })

  test.each([
    ["line @ts-ignore", "// @ts-ignore\nconst value = 1\n"],
    ["line @ts-nocheck", "// @ts-nocheck\nconst value = 1\n"],
    ["block @ts-nocheck", "/* @ts-nocheck */\nconst value = 1\n"],
  ])("rejects %s suppression directives", (_, source) => {
    expectRejected("src/policy.ts", source, "TypeScript suppression")
  })

  test("rejects as any even when later source is syntactically invalid", () => {
    expectRejected("src/policy.ts", "const value = input as any ???\n", "as any")
  })
})
