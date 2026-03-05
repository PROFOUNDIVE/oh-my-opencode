import { rmSync } from "node:fs"
import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool"
import {
  getOpenMathStateFilePath,
  readOpenMathSessionState,
  writeOpenMathSessionState,
} from "../../openmath/storage"
import { createInitialOpenMathSessionState } from "../../openmath/state"
import {
  OpenMathStateGetInputSchema,
  OpenMathStateSetInputSchema,
  OpenMathStateResetInputSchema,
} from "./types"

type OpenMathStateToolDefaults = {
  max_review_rounds?: number
}

export function createOpenMathStateTools(
  directory: string,
  defaults?: OpenMathStateToolDefaults
): Record<string, ToolDefinition> {
  const openmath_state_get: ToolDefinition = tool({
    description: "Get persisted OpenMath session state by session_id. Returns null if state is missing.",
    args: {
      session_id: tool.schema.string().describe("OpenMath session id to read"),
      init_if_missing: tool.schema
        .boolean()
        .optional()
        .describe(
          "If true and no persisted state exists, bootstrap initial state using configured defaults and persist it",
        ),
    },
    execute: async (args: Record<string, unknown>) => {
      try {
        const validatedArgs = OpenMathStateGetInputSchema.parse(args)

        const existingState = readOpenMathSessionState(directory, validatedArgs.session_id)
        if (existingState) {
          return JSON.stringify({ state: existingState })
        }

        if (validatedArgs.init_if_missing === true) {
          const maxReviewRounds = defaults?.max_review_rounds ?? 3
          const initialState = createInitialOpenMathSessionState(
            validatedArgs.session_id,
            3,
            maxReviewRounds,
          )
          const writeOk = writeOpenMathSessionState(directory, initialState)
          if (!writeOk) {
            return JSON.stringify({ error: "write_failed" })
          }
          return JSON.stringify({ state: initialState })
        }

        return JSON.stringify({ state: null })
      } catch (error) {
        if (error instanceof Error) {
          return JSON.stringify({ error: "validation_error", message: error.message })
        }
        return JSON.stringify({ error: "unknown_error" })
      }
    },
  })

  const openmath_state_set: ToolDefinition = tool({
    description: "Set full OpenMath session state after validating required fields and shape.",
    args: {
      state: tool.schema
        .record(tool.schema.string(), tool.schema.unknown())
        .describe("Full OpenMathSessionState payload to persist"),
    },
    execute: async (args: Record<string, unknown>) => {
      try {
        const validatedArgs = OpenMathStateSetInputSchema.parse(args)
        const writeOk = writeOpenMathSessionState(directory, validatedArgs.state)
        if (!writeOk) {
          return JSON.stringify({ error: "write_failed" })
        }

        return JSON.stringify({ ok: true })
      } catch (error) {
        if (error instanceof Error) {
          return JSON.stringify({ error: "validation_error", message: error.message })
        }
        return JSON.stringify({ error: "unknown_error" })
      }
    },
  })

  const openmath_state_reset: ToolDefinition = tool({
    description: "Reset OpenMath session state for a session_id by removing the persisted state file.",
    args: {
      session_id: tool.schema.string().describe("OpenMath session id to reset"),
    },
    execute: async (args: Record<string, unknown>) => {
      try {
        const validatedArgs = OpenMathStateResetInputSchema.parse(args)
        const filePath = getOpenMathStateFilePath(directory, validatedArgs.session_id)
        rmSync(filePath, { force: true })
        return JSON.stringify({ ok: true })
      } catch (error) {
        if (error instanceof Error) {
          return JSON.stringify({ error: "validation_error", message: error.message })
        }
        return JSON.stringify({ error: "unknown_error" })
      }
    },
  })

  return {
    openmath_state_get,
    openmath_state_set,
    openmath_state_reset,
  }
}
