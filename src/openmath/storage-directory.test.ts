/// <reference types="bun-types" />

import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { basename, dirname, join } from "node:path"

import { getOpenMathStorageDirectory } from "./storage-directory"

test("keeps the existing project storage base when no override is configured", () => {
  // given
  const project = "project-without-config"

  // when
  const directory = getOpenMathStorageDirectory(project)

  // then
  expect(directory).toBe(project)
})

test("resolves relative roots consistently through canonical project aliases", () => {
  // given
  const sandbox = mkdtempSync(join(tmpdir(), "openmath-storage-directory-"))
  const project = join(sandbox, "project")
  const aliases = join(sandbox, "aliases")
  mkdirSync(project)
  mkdirSync(aliases)
  const alias = join(aliases, "project-link")
  symlinkSync(project, alias, "junction")
  try {
    // when
    const canonical = getOpenMathStorageDirectory(project, "../local")
    const aliased = getOpenMathStorageDirectory(alias, "../local")

    // then
    expect(aliased).toBe(canonical)
    expect(canonical.startsWith(join(sandbox, "local"))).toBe(true)
  } finally {
    rmSync(sandbox, { recursive: true, force: true })
  }
})

test("expands a home-relative root without exposing project path characters in the namespace", () => {
  // given
  const project = mkdtempSync(join(tmpdir(), "openmath-project-"))
  try {
    // when
    const directory = getOpenMathStorageDirectory(project, "~/openmath-local-state")

    // then
    expect(dirname(directory)).toBe(join(homedir(), "openmath-local-state"))
    expect(basename(directory)).toMatch(/^[a-f0-9]{64}$/)
  } finally {
    rmSync(project, { recursive: true, force: true })
  }
})
