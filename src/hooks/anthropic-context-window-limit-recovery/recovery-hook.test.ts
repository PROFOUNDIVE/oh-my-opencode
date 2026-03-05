import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"

import * as executor from "./executor"
import * as parser from "./parser"

const executeCompactMock = mock(async (_sessionID: string) => {})
const getLastAssistantMock = mock(async (_sessionID: string) => ({
  providerID: "anthropic",
  modelID: "claude-sonnet-4-6",
}))
const parseAnthropicTokenLimitErrorMock = mock((_err: unknown) => ({
  providerID: "anthropic",
  modelID: "claude-sonnet-4-6",
}))

function createMockContext(): PluginInput {
  return {
    client: {
      session: {
        messages: mock(() => Promise.resolve({ data: [] })),
      },
      tui: {
        showToast: mock(() => Promise.resolve()),
      },
    },
    directory: "/tmp",
  } as unknown as PluginInput
}

function setupDelayedTimeoutMocks(): {
  restore: () => void
  getClearTimeoutCalls: () => Array<ReturnType<typeof setTimeout>>
} {
  const originalSetTimeout = globalThis.setTimeout
  const originalClearTimeout = globalThis.clearTimeout
  const clearTimeoutCalls: Array<ReturnType<typeof setTimeout>> = []
  let timeoutCounter = 0

  globalThis.setTimeout = ((_: () => void, _delay?: number) => {
    timeoutCounter += 1
    return timeoutCounter as unknown as ReturnType<typeof setTimeout>
  }) as typeof setTimeout

  globalThis.clearTimeout = ((timeoutID: ReturnType<typeof setTimeout>) => {
    clearTimeoutCalls.push(timeoutID)
  }) as typeof clearTimeout

  return {
    restore: () => {
      globalThis.setTimeout = originalSetTimeout
      globalThis.clearTimeout = originalClearTimeout
    },
    getClearTimeoutCalls: () => clearTimeoutCalls,
  }
}

describe("createAnthropicContextWindowLimitRecoveryHook", () => {
  let executeCompactSpy: ReturnType<typeof spyOn>
  let getLastAssistantSpy: ReturnType<typeof spyOn>
  let parseSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    executeCompactMock.mockClear()
    getLastAssistantMock.mockClear()
    parseAnthropicTokenLimitErrorMock.mockClear()

    executeCompactSpy = spyOn(executor, "executeCompact").mockImplementation(executeCompactMock as never)
    getLastAssistantSpy = spyOn(executor, "getLastAssistant").mockImplementation(getLastAssistantMock as never)
    parseSpy = spyOn(parser, "parseAnthropicTokenLimitError").mockImplementation(
      parseAnthropicTokenLimitErrorMock as never
    )
  })

  afterEach(() => {
    executeCompactSpy.mockRestore()
    getLastAssistantSpy.mockRestore()
    parseSpy.mockRestore()
  })

  test("cancels pending timer when session.idle handles compaction first", async () => {
    //#given
    const { restore, getClearTimeoutCalls } = setupDelayedTimeoutMocks()
    const { createAnthropicContextWindowLimitRecoveryHook } = await import("./recovery-hook")
    const hook = createAnthropicContextWindowLimitRecoveryHook(createMockContext())

    try {
      //#when
      await hook.event({
        event: {
          type: "session.error",
          properties: { sessionID: "session-race", error: "prompt is too long" },
        },
      })

      await hook.event({
        event: {
          type: "session.idle",
          properties: { sessionID: "session-race" },
        },
      })

      //#then
      expect(getClearTimeoutCalls()).toEqual([1 as unknown as ReturnType<typeof setTimeout>])
      expect(executeCompactMock).toHaveBeenCalledTimes(1)
      expect(executeCompactMock.mock.calls[0]?.[0]).toBe("session-race")
    } finally {
      restore()
    }
  })
})
