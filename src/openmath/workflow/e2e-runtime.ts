import { compareAndSwapWorkflowState } from "./storage"
import type { WorkflowStateV1 } from "./state"
import type { StageRunnerRuntime } from "./stage-runner"

export type E2ERuntimeMode = "normal" | "crash_prepared" | "crash_completed" | "ambiguous"

export type E2ERuntimeControl = {
  mode: E2ERuntimeMode
  crashed: boolean
  readonly verdicts: string[]
  childCount: number
  knownTitle: string
  readonly children: Array<{ readonly id: string; readonly title: string }>
  readonly messages: Array<{ readonly role: string; readonly text: string }>
}

export function createE2ERuntime(
  directory: string,
  initial: WorkflowStateV1,
  control: E2ERuntimeControl,
): StageRunnerRuntime {
  let current = initial
  return {
    persist: async (next) => {
      const result = await compareAndSwapWorkflowState({
        directory,
        run_id: current.run_id,
        expected_state_revision: current.state_revision,
        next_state: next,
      })
      if (result.kind === "error") throw new Error(result.message)
      current = result.state
      control.knownTitle = current.dispatch_attempts.at(-1)?.child_title ?? control.knownTitle
      const phase = current.dispatch_attempts.at(-1)?.phase
      if (!control.crashed && ((control.mode === "crash_prepared" && phase === "PREPARED") || (control.mode === "crash_completed" && phase === "COMPLETED"))) {
        control.crashed = true
        throw new Error(`planned crash after ${phase}`)
      }
      return current
    },
    list_children: async () => control.mode === "ambiguous"
      ? [{ id: "ambiguous-1" }, { id: "ambiguous-2" }]
      : control.children.map(({ id }) => ({ id })),
    get_session: async (id) => {
      if (control.mode === "ambiguous") return { title: control.knownTitle }
      const child = control.children.find((candidate) => candidate.id === id)
      if (!child) throw new Error(`Unknown E2E child: ${id}`)
      return { title: child.title }
    },
    list_messages: async () => control.messages,
    dispatch: async (input) => {
      const sessionID = input.persisted_session_id ?? `child-${++control.childCount}`
      if (input.persisted_session_id === undefined) {
        control.children.push({ id: sessionID, title: input.child_title })
        await input.awaited_callbacks.on_session_created?.(sessionID)
      }
      if (input.send_prompt) {
        control.messages.push({ role: "user", text: `${input.prompt_marker}${input.user_prompt}` })
        await input.awaited_callbacks.on_prompt_sent?.(sessionID)
      }
      return { ok: true, session_id: sessionID, text: outputFor(input.agent_to_use, control.verdicts) }
    },
  }
}

function outputFor(agent: string, verdicts: string[]): string {
  if (agent === "reviewer") {
    const verdict = verdicts.shift() ?? "PASS"
    return verdict === "MALFORMED" ? "Reviewer output without a verdict" : `VERDICT: ${verdict}`
  }
  return agent === "reviser" ? "# revised artifact\n" : "# solved artifact\n"
}
