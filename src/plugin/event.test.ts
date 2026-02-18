import { describe, expect, it } from "bun:test"

import { createEventHandler } from "./event"

type EventInput = { event: { type: string; properties?: Record<string, unknown> } }

function createHandlerWithIdleCapture(dispatchCalls: EventInput[]) {
  return createEventHandler({
    ctx: {
      directory: ".",
      client: {
        session: {
          prompt: async () => {},
        },
      },
    } as any,
    pluginConfig: {} as any,
    firstMessageVariantGate: {
      markSessionCreated: () => {},
      clear: () => {},
    },
    managers: {
      backgroundManager: {
        getTask: () => undefined,
        getAllDescendantTasks: () => [],
        cancelTask: async () => false,
      },
      configHandler: async () => {
        return
      },
    } as any,
    hooks: {
      backgroundNotificationHook: {
        event: async (input: EventInput) => {
          if (input.event.type === "session.idle") {
            dispatchCalls.push(input)
          }
        },
      },
    },
  })
}

describe("createEventHandler - idle deduplication", () => {
  it("Order A (status->idle): synthetic idle is deduped against real idle", async () => {
    const dispatchCalls: EventInput[] = []
    const eventHandler = createHandlerWithIdleCapture(dispatchCalls)
    const sessionId = "ses_test123"

    await eventHandler({
      event: {
        type: "session.status",
        properties: { sessionID: sessionId, status: { type: "idle" } },
      },
    })

    expect(dispatchCalls.length).toBe(1)
    expect(dispatchCalls[0].event.type).toBe("session.idle")

    await eventHandler({
      event: {
        type: "session.idle",
        properties: { sessionID: sessionId },
      },
    })

    expect(dispatchCalls.length).toBe(1)
  })

  it("Order B (idle->status): real idle is deduped against synthetic idle", async () => {
    const dispatchCalls: EventInput[] = []
    const eventHandler = createHandlerWithIdleCapture(dispatchCalls)
    const sessionId = "ses_test456"

    await eventHandler({
      event: {
        type: "session.idle",
        properties: { sessionID: sessionId },
      },
    })

    expect(dispatchCalls.length).toBe(1)

    await eventHandler({
      event: {
        type: "session.status",
        properties: { sessionID: sessionId, status: { type: "idle" } },
      },
    })

    expect(dispatchCalls.length).toBe(1)
  })

  it("outside the dedup window both idle events dispatch", async () => {
    const dispatchCalls: EventInput[] = []
    const eventHandler = createHandlerWithIdleCapture(dispatchCalls)
    const sessionId = "ses_outside_window"

    await eventHandler({
      event: {
        type: "session.status",
        properties: { sessionID: sessionId, status: { type: "idle" } },
      },
    })

    expect(dispatchCalls.length).toBe(1)

    await new Promise((resolve) => setTimeout(resolve, 600))

    await eventHandler({
      event: {
        type: "session.idle",
        properties: { sessionID: sessionId },
      },
    })

    expect(dispatchCalls.length).toBe(2)
  })
})
