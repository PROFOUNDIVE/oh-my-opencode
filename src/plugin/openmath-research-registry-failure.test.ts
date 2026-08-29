import { describe, expect, test } from "bun:test"

import { OhMyOpenCodeConfigSchema } from "../config/schema"
import { loadBuiltinCommands } from "../features/builtin-commands"
import { filterDisabledTools } from "../shared/disabled-tools"
import { createOpenMathResearchTools } from "../tools"
import { researchToolConfig } from "../tools/openmath-research-test-support"

const RESEARCH_TOOL_KEYS = [
  "openmath_research_start",
  "openmath_research_status",
  "openmath_research_step",
  "openmath_research_amend",
  "openmath_research_promote",
  "openmath_research_abort",
] as const

const RESEARCH_COMMAND_NAMES = [
  "openmath-research-start",
  "openmath-research-status",
  "openmath-research-step",
  "openmath-research-amend",
  "openmath-research-promote",
  "openmath-research-abort",
] as const

describe("OpenMath research registry failure cases", () => {
  test("disables each research tool without affecting siblings", () => {
    const tools = createOpenMathResearchTools({
      directory: process.cwd(),
      openmathConfig: researchToolConfig(),
    })

    for (const disabled of RESEARCH_TOOL_KEYS) {
      expect(Object.keys(filterDisabledTools(tools, [disabled])).sort()).toEqual(
        RESEARCH_TOOL_KEYS.filter((name) => name !== disabled).sort(),
      )
    }
  })

  test("disables each research command without affecting siblings", () => {
    for (const disabled of RESEARCH_COMMAND_NAMES) {
      const commands = loadBuiltinCommands([disabled])
      expect(commands[disabled]).toBeUndefined()
      for (const sibling of RESEARCH_COMMAND_NAMES) {
        if (sibling !== disabled) expect(commands[sibling]).toBeDefined()
      }
    }
  })

  test("rejects near-miss research tool and command names", () => {
    for (const name of RESEARCH_TOOL_KEYS) {
      expect(OhMyOpenCodeConfigSchema.safeParse({ disabled_tools: [name] }).success).toBe(true)
    }
    for (const name of RESEARCH_COMMAND_NAMES) {
      expect(OhMyOpenCodeConfigSchema.safeParse({ disabled_commands: [name] }).success).toBe(true)
    }
    expect(OhMyOpenCodeConfigSchema.safeParse({
      disabled_tools: ["openmath_research_promtoe"],
    }).success).toBe(false)
    expect(OhMyOpenCodeConfigSchema.safeParse({
      disabled_commands: ["openmath-research-promtoe"],
    }).success).toBe(false)
  })
})
