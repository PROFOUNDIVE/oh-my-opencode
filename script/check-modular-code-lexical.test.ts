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

function templateSource(name: string, lines: readonly string[]): string {
  return [`const ${name} = \``, ...lines, "\`"].join("\n")
}

function lineBrokenTemplateSource(name: string, lines: readonly string[]): string {
  return [`const ${name} =`, "`", ...lines, "`"].join("\n")
}

describe("check-modular-code lexical scanning", () => {
  test("rejects executable syntax after a regex literal with quote characters", () => {
    expectRejected("src/policy.ts", "const matcher = /['\"]/\nconst value = input as any\n// @ts-nocheck\n", "as any")
  })

  test("exits for-of regex mode before scanning a later suppression directive", () => {
    expectRejected("src/policy.ts", "for (const item of /['\"]/.source) { void item }\n// @ts-nocheck\nconst value = 1\n", "TypeScript suppression")
  })

  test.each([
    ["await", "async function matcher() { return await /['\"]/gi.source }"],
    ["if", "if (enabled) /['\"]/gi.test(value)"],
    ["else", "if (enabled) work(); else /['\"]/gi.test(value)"],
    ["for-of", "for (const item of /['\"]/gi.source) { void item }"],
    ["return", "function matcher() { return /['\"]/gi.source }"],
    ["throw", "function matcher() { throw /['\"]/gi }"],
    ["case", "switch (value) { case /['\"]/gi.source: break }"],
    ["assignment", "const value = /['\"]/gi.source"],
    ["ternary", "enabled ? /['\"]/gi.test(value) : false"],
    ["comma", "work(), /['\"]/gi.test(value)"],
    ["parentheses", "(/['\"]/gi.test(value))"],
    ["arrow", "const matcher = () => /['\"]/gi.test(value)"],
  ])("detects suppression after a regex in %s context", (_, expression) => {
    expectRejected("src/policy.ts", `${expression}\n// @ts-nocheck\nconst value = 1\n`, "TypeScript suppression")
  })

  test("excludes prompt and documentation template bodies", () => {
    expectAccepted("src/policy.ts", templateSource("documentation", Array.from({ length: 201 }, () => "instruction")))
  })

  test("excludes prompt templates with escaped backticks", () => {
    expectAccepted("src/policy.ts", templateSource("prompt", ["\\` escaped delimiter", ...Array.from({ length: 201 }, () => "instruction")]))
  })

  test("counts ordinary template bodies as code", () => {
    expectRejected("src/policy.ts", templateSource("sql", Array.from({ length: 201 }, () => "SELECT 1")), "logic LOC exceeds 200")
  })

  test("counts a promptCount-owned template as ordinary code", () => {
    expectRejected("src/policy.ts", templateSource("promptCount", Array.from({ length: 201 }, () => "SELECT 1")), "logic LOC exceeds 200")
  })

  test("excludes a prompt template opened after a line-broken assignment", () => {
    expectAccepted("src/policy.ts", lineBrokenTemplateSource("prompt", Array.from({ length: 201 }, () => "instruction")))
  })

  test("excludes a prompt property template body", () => {
    expectAccepted("src/policy.ts", ["const config = { prompt: `", ...Array.from({ length: 201 }, () => "instruction"), "` }"].join("\n"))
  })

  test.each([
    ["prompt", "const prompt = `intro ${value}\n// @ts-nocheck\noutro`\n"],
    ["ordinary template", "const sql = `select ${value}\n// @ts-nocheck\nfrom table`\n"],
    ["template literal type", "type Label = `intro ${string}\n// @ts-nocheck\noutro`\n"],
    ["quoted string", 'const text = "// @ts-nocheck"\n'],
  ])("ignores directive text in a %s literal", (_, source) => {
    expectAccepted("src/policy.ts", source)
  })

  test("rejects a directive in an executable template expression", () => {
    expectRejected("src/policy.ts", "const prompt = `intro ${(() => { /* @ts-nocheck */ return value })()} outro`\n", "TypeScript suppression")
  })

  test("scans executable expressions inside prompt templates", () => {
    expectRejected("src/policy.ts", "const prompt = `Instruction: ${input as any}`\n", "as any")
  })

  test("scans executable template expressions", () => {
    expectRejected("src/policy.ts", "const query = `SELECT ${input as any}`\n", "as any")
  })
})
