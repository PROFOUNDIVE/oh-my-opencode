import { describe, expect, test } from "bun:test"

import { OhMyOpenCodeConfigSchema, OpenMathConfigSchema } from "../config/schema"
import { loadBuiltinCommands } from "../features/builtin-commands"
import { filterDisabledTools } from "../shared/disabled-tools"
import { createOpenMathWorkflowTools } from "../tools"

const WORKFLOW_TOOL_KEYS = [
  "openmath_workflow_start",
  "openmath_workflow_step",
  "openmath_workflow_status",
  "openmath_workflow_amend",
  "openmath_workflow_reload",
  "openmath_workflow_abort",
] as const

const WORKFLOW_COMMAND_NAMES = [
  "openmath-workflow-start",
  "openmath-workflow-step",
  "openmath-workflow-status",
  "openmath-workflow-amend",
  "openmath-workflow-reload",
  "openmath-workflow-abort",
] as const

const EXISTING_COMMAND_NAMES = [
  "handoff",
  "openmath-solve-only",
  "openmath-export",
] as const

describe("OpenMath workflow registry failure cases", () => {
  test("removes only the selected workflow tool", () => {
    for (const disabledTool of WORKFLOW_TOOL_KEYS) {
      const filtered = filterDisabledTools(
        createOpenMathWorkflowTools({
          directory: process.cwd(),
          openmathConfig: OpenMathConfigSchema.parse({}),
        }),
        [disabledTool],
      )

      expect(Object.keys(filtered).sort()).toEqual(
        WORKFLOW_TOOL_KEYS.filter((toolName) => toolName !== disabledTool).sort(),
      )
    }
  })

  test("removes only the selected workflow command", () => {
    for (const disabledCommand of WORKFLOW_COMMAND_NAMES) {
      const commands = loadBuiltinCommands([disabledCommand])

      expect(commands[disabledCommand]).toBeUndefined()
      for (const commandName of WORKFLOW_COMMAND_NAMES) {
        if (commandName !== disabledCommand) {
          expect(commands[commandName]).toBeDefined()
        }
      }
    }
  })

  test("accepts and filters each existing command disable name", () => {
    for (const disabledCommand of EXISTING_COMMAND_NAMES) {
      const parsed = OhMyOpenCodeConfigSchema.safeParse({
        disabled_commands: [disabledCommand],
      })

      expect(parsed.success).toBe(true)
      if (parsed.success) {
        const commands = loadBuiltinCommands(parsed.data.disabled_commands)

        expect(commands[disabledCommand]).toBeUndefined()
        for (const commandName of EXISTING_COMMAND_NAMES) {
          if (commandName !== disabledCommand) {
            expect(commands[commandName]).toBeDefined()
          }
        }
      }
    }
  })

  test("accepts only exact workflow disable names", () => {
    for (const toolName of WORKFLOW_TOOL_KEYS) {
      expect(OhMyOpenCodeConfigSchema.safeParse({ disabled_tools: [toolName] }).success).toBe(true)
    }
    for (const commandName of WORKFLOW_COMMAND_NAMES) {
      expect(OhMyOpenCodeConfigSchema.safeParse({ disabled_commands: [commandName] }).success).toBe(true)
    }

    expect(OhMyOpenCodeConfigSchema.safeParse({ disabled_tools: ["openmath_workflow_strt"] }).success).toBe(false)
    expect(OhMyOpenCodeConfigSchema.safeParse({ disabled_commands: ["openmath-workflow-strt"] }).success).toBe(false)
  })
})
