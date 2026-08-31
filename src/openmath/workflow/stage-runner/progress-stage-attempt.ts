import type { WorkflowStateV1 } from "../state"
import { reduceTransition } from "../transitions"
import { reconcilePreparedAttempt, reconcileSessionCreatedAttempt } from "./attempt-reconciliation"
import { completedAttempt, promptSentAttempt, replaceAttempt, sessionCreatedAttempt } from "./attempt-phase"
import { blockWorkflowReconciliation } from "./block-reconciliation"
import { prepareStageAttempt } from "./prepare-stage-attempt"
import { stageReceiptFromOutput, subagentFailureReceipt } from "./stage-receipt"
import type { StageRunnerRuntime } from "./stage-runner-types"

type RunningState = Extract<WorkflowStateV1, { readonly status: "RUNNING" }>
type StageAttempt = RunningState["dispatch_attempts"][number]
type PreparedAttempt = Extract<StageAttempt, { readonly phase: "PREPARED" }>
type SessionCreatedAttempt = Extract<StageAttempt, { readonly phase: "SESSION_CREATED" }>
type PromptSentAttempt = Extract<StageAttempt, { readonly phase: "PROMPT_SENT" }>

export async function progressStageAttempt(input: Readonly<{
  readonly state: RunningState
  readonly workflow_input: string
  readonly runtime: StageRunnerRuntime
}>): Promise<WorkflowStateV1> {
  const attempt = activeAttempt(input.state)
  if (!attempt) return prepareAndProgress(input)
  const stageInput = prepareStageAttempt({ state: input.state, workflow_input: input.workflow_input }).input
  switch (attempt.phase) {
    case "PREPARED":
      return progressPrepared({
        state: input.state,
        attempt,
        workflow_input: input.workflow_input,
        stage_input: stageInput,
        runtime: input.runtime,
      })
    case "SESSION_CREATED":
      return progressSessionCreated({ state: input.state, attempt, stage_input: stageInput, runtime: input.runtime })
    case "PROMPT_SENT":
      return dispatchAttempt({ state: input.state, attempt, stage_input: stageInput, runtime: input.runtime, send_prompt: false })
    case "COMPLETED":
      return commitCompletedAttempt(input.state, input.runtime)
    case "COMMITTED":
      return input.state
    default:
      return assertNever(attempt)
  }
}

async function prepareAndProgress(input: Readonly<{
  readonly state: RunningState
  readonly workflow_input: string
  readonly runtime: StageRunnerRuntime
}>): Promise<WorkflowStateV1> {
  const prepared = prepareStageAttempt({ state: input.state, workflow_input: input.workflow_input })
  const state = await persistRunning(input.runtime, {
    ...input.state,
    dispatch_attempts: [...input.state.dispatch_attempts, prepared.attempt],
  })
  return progressStageAttempt({ ...input, state })
}

async function progressPrepared(input: Readonly<{
  readonly state: RunningState
  readonly attempt: PreparedAttempt
  readonly workflow_input: string
  readonly stage_input: ReturnType<typeof prepareStageAttempt>["input"]
  readonly runtime: StageRunnerRuntime
}>): Promise<WorkflowStateV1> {
  const reconciliation = await reconcilePreparedAttempt({
    parent_session_id: input.state.parent_session_id,
    attempt: input.attempt,
    list_children: input.runtime.list_children,
    get_session: input.runtime.get_session,
  })
  switch (reconciliation.kind) {
    case "create":
      return dispatchAttempt({ state: input.state, attempt: input.attempt, stage_input: input.stage_input, runtime: input.runtime, send_prompt: true })
    case "resume": {
      const state = await persistRunning(input.runtime, replaceAttempt(input.state, sessionCreatedAttempt(input.attempt, reconciliation.child_session_id)))
      return progressStageAttempt({ state, workflow_input: input.workflow_input, runtime: input.runtime })
    }
    case "blocked":
      return input.runtime.persist(blockWorkflowReconciliation({ state: input.state, attempt: input.attempt, message: reconciliation.message }))
    default:
      return assertNever(reconciliation)
  }
}

async function progressSessionCreated(input: Readonly<{
  readonly state: RunningState
  readonly attempt: SessionCreatedAttempt
  readonly stage_input: ReturnType<typeof prepareStageAttempt>["input"]
  readonly runtime: StageRunnerRuntime
}>): Promise<WorkflowStateV1> {
  const reconciliation = await reconcileSessionCreatedAttempt({ attempt: input.attempt, list_messages: input.runtime.list_messages })
  switch (reconciliation.kind) {
    case "send":
      return dispatchAttempt({ state: input.state, attempt: input.attempt, stage_input: input.stage_input, runtime: input.runtime, send_prompt: true })
    case "resume": {
      const state = await persistRunning(input.runtime, replaceAttempt(input.state, promptSentAttempt(input.attempt)))
      return dispatchAttempt({
        state,
        attempt: promptSentAttempt(input.attempt),
        stage_input: input.stage_input,
        runtime: input.runtime,
        send_prompt: false,
      })
    }
    case "blocked":
      return input.runtime.persist(blockWorkflowReconciliation({ state: input.state, attempt: input.attempt, message: reconciliation.message }))
    default:
      return assertNever(reconciliation)
  }
}

async function dispatchAttempt(input: Readonly<{
  readonly state: RunningState
  readonly attempt: PreparedAttempt | SessionCreatedAttempt | PromptSentAttempt
  readonly stage_input: ReturnType<typeof prepareStageAttempt>["input"]
  readonly runtime: StageRunnerRuntime
  readonly send_prompt: boolean
}>): Promise<WorkflowStateV1> {
  let state: WorkflowStateV1 = input.state
  const result = await input.runtime.dispatch({
    parent_session_id: state.parent_session_id,
    child_title: input.attempt.child_title,
    agent_to_use: input.attempt.role,
    category_model: input.attempt.resolved_model,
    system_content: input.stage_input.system_content,
    user_prompt: input.stage_input.user_prompt,
    prompt_marker: `OPENMATH_ATTEMPT_KEY: ${input.attempt.idempotency_key}\n`,
    persisted_session_id: "child_session_id" in input.attempt ? input.attempt.child_session_id : undefined,
    send_prompt: input.send_prompt,
    tool_policy: state.request_snapshot?.kind === "research_educationalization" ? "deny_all" : undefined,
    awaited_callbacks: {
      on_session_created: async (sessionID) => {
        if (input.attempt.phase !== "PREPARED") return
        if (state.status !== "RUNNING") return
        state = await persistRunning(input.runtime, replaceAttempt(state, sessionCreatedAttempt(input.attempt, sessionID)))
      },
      on_prompt_sent: async () => {
        if (state.status !== "RUNNING") return
        const attempt = activeAttempt(state)
        if (!attempt || attempt.phase !== "SESSION_CREATED") return
        const reconciliation = await reconcileSessionCreatedAttempt({ attempt, list_messages: input.runtime.list_messages })
        if (reconciliation.kind === "resume") {
          state = await persistRunning(input.runtime, replaceAttempt(state, promptSentAttempt(attempt)))
          return
        }
        const message = reconciliation.kind === "blocked"
          ? reconciliation.message
          : "The sent prompt marker was not persisted in the child transcript"
        const blocked = blockWorkflowReconciliation({ state, attempt, message })
        state = await input.runtime.persist(blocked)
      },
    },
  })
  if (state.status !== "RUNNING") return state
  const attempt = activeAttempt(state)
  if (!attempt || attempt.phase !== "PROMPT_SENT") {
    const blockingAttempt = attempt ?? input.attempt
    return input.runtime.persist(blockWorkflowReconciliation({
      state,
      attempt: blockingAttempt,
      message: "Dispatch completed without a persisted prompt marker receipt",
    }))
  }
  const completed = result.ok
    ? completedAttempt(attempt, result.text, stageReceiptFromOutput({ state, attempt, raw_output: result.text }))
    : completedAttempt(attempt, "", subagentFailureReceipt(result.error, result.error_code, result.legacy_failure))
  state = await persistRunning(input.runtime, replaceAttempt(state, completed))
  return commitCompletedAttempt(state, input.runtime)
}

async function commitCompletedAttempt(state: RunningState, runtime: StageRunnerRuntime): Promise<WorkflowStateV1> {
  const transition = reduceTransition(state, { type: "COMMIT_STAGE_RECEIPT" })
  return transition.ok ? runtime.persist(transition.state) : state
}

function activeAttempt(state: RunningState): StageAttempt | undefined {
  return state.dispatch_attempts.findLast((attempt) => (
    attempt.stage === state.next_stage
    && attempt.review_round === state.review_round
    && attempt.phase !== "COMMITTED"
  ))
}

async function persistRunning(runtime: StageRunnerRuntime, state: RunningState): Promise<RunningState> {
  const persisted = await runtime.persist(state)
  if (persisted.status !== "RUNNING") throw new TypeError("Expected a RUNNING workflow state")
  return persisted
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected attempt state: ${String(value)}`)
}
