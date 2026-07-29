import { WorkflowStateV1Schema, type WorkflowStateV1 } from "../state"
import type { StageRunnerRuntime, StageSubagentDispatch } from "./stage-runner-types"

export type CrashBoundary = "PREPARED" | "CHILD_CREATED" | "SESSION_CREATED" | "PROMPT_APPENDED" | "PROMPT_SENT" | "OUTPUT_FETCHED" | "COMPLETED"
export type QueryFailure = "children" | "get" | "messages"

export function createCrashRuntime(state: WorkflowStateV1, boundary: CrashBoundary | undefined, queryFailure?: QueryFailure) {
  let current = state
  let crashArmed = true
  let childCreated = 0
  let promptSent = 0
  let outputFetched = 0
  const parents: string[] = []
  const children: Array<{ readonly id: string; readonly title: string }> = []
  const messages: Array<{ readonly role: string; readonly text: string }> = []
  const phases: string[] = []
  const dispatches: StageSubagentDispatch[] = []
  const runtime: StageRunnerRuntime = {
    persist: async (next) => {
      const persisted = next.state_revision > current.state_revision
        ? next
        : WorkflowStateV1Schema.parse({ ...next, state_revision: current.state_revision + 1 })
      current = persisted
      const phase = current.dispatch_attempts[current.dispatch_attempts.length - 1]?.phase
      if (phase) phases.push(phase)
      if (crashArmed && boundary !== undefined && phase === boundary) {
        crashArmed = false
        throw new Error(`crash after ${boundary}`)
      }
      return current
    },
    list_children: async (parent) => {
      parents.push(parent)
      if (queryFailure === "children") throw new Error("children unavailable")
      if (queryFailure === "get") return [{ id: "child-1" }]
      return children.map(({ id }) => ({ id }))
    },
    get_session: async (id) => {
      if (queryFailure === "get") throw new Error("get unavailable")
      const child = children.find((candidate) => candidate.id === id)
      if (!child) throw new Error("missing child")
      return { title: child.title }
    },
    list_messages: async () => {
      if (queryFailure === "messages") throw new Error("messages unavailable")
      return messages
    },
    dispatch: async (input) => {
      dispatches.push(input)
      let sessionID = input.persisted_session_id
      if (!sessionID) {
        sessionID = "child-1"
        childCreated += 1
        children.push({ id: sessionID, title: input.child_title })
        if (crashArmed && boundary === "CHILD_CREATED") { crashArmed = false; throw new Error("crash after CHILD_CREATED") }
        await input.awaited_callbacks.on_session_created?.(sessionID)
      }
      if (input.send_prompt) {
        promptSent += 1
        messages.push({ role: "user", text: `${input.prompt_marker}${input.user_prompt}` })
        if (crashArmed && boundary === "PROMPT_APPENDED") { crashArmed = false; throw new Error("crash after PROMPT_APPENDED") }
        await input.awaited_callbacks.on_prompt_sent?.(sessionID)
      }
      outputFetched += 1
      if (crashArmed && boundary === "OUTPUT_FETCHED") {
        crashArmed = false
        throw new Error("crash after OUTPUT_FETCHED")
      }
      const text = input.agent_to_use === "reviewer"
        ? "VERDICT: REVISE\n"
        : input.agent_to_use === "reviser" ? "# revised artifact\n" : "# artifact\n"
      return { ok: true, session_id: sessionID, text }
    },
  }
  return {
    runtime,
    resume: () => { crashArmed = false },
    get state() { return current },
    get child_created() { return childCreated },
    get prompt_sent() { return promptSent },
    get output_fetched() { return outputFetched },
    get parent_lookups() { return parents },
    get phase_history() { return phases },
    get dispatches() { return dispatches },
    seed_child: (title: string, id: string) => { children.push({ id, title }) },
    seed_message: (text: string) => { messages.push({ role: "user", text }) },
  }
}
