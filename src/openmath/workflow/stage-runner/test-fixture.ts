import { WorkflowStateV1Schema, type WorkflowStateV1 } from "../state"
import { createWorkflowStateFixture } from "../state/test-fixture"

const HASH = "c".repeat(64)

export function runningWorkflowState(stage: "SOLVE" | "REVIEW" | "REVISE"): Extract<WorkflowStateV1, { readonly status: "RUNNING" }> {
  const artifact = stage === "SOLVE"
    ? null
    : {
        version: 1,
        media_type: "text/markdown" as const,
        content: "# Existing artifact\n",
        sha256: HASH,
      }

  const state = WorkflowStateV1Schema.parse({
    ...createWorkflowStateFixture(),
    state_revision: 7,
    status: "RUNNING",
    next_stage: stage,
    awaiting_reason: null,
    abort_requested: false,
    abort_reason: null,
    blocked_reason: null,
    intervention_satisfied: false,
    artifact,
    profile_snapshot: {
      ...createWorkflowStateFixture().profile_snapshot,
      solve: role("solver", "opaque_markdown", "solve system"),
      review: role("reviewer", "review_verdict_markdown", "review system"),
      revise: role("reviser", "full_replace_markdown", "revise system"),
    },
    reference_snapshot: {
      version: 1,
      manifest: { kind: "legacy_supplementary" },
      references: [
        {
          id: "reference-1",
          role: "authoritative",
          stages: ["solve", "review", "revise"],
          required: true,
          content: "reference bytes",
          sha256: HASH,
          source: { kind: "inline", path: "fixture" },
        },
      ],
      diagnostics: [],
      sha256: HASH,
    },
    amendments: [
      {
        event_type: "ADDED",
        amendment_id: "amendment-1",
        kind: "required_check",
        scope: "all_remaining",
        content: "check edge condition",
        lifecycle: "ACTIVE",
        state_revision: 1,
      },
    ],
    dispatch_attempts: [],
  })
  if (state.status !== "RUNNING") throw new TypeError("Expected a RUNNING stage fixture")
  return state
}

export function preparedAttempt(stage: "SOLVE" | "REVIEW" | "REVISE") {
  const key = HASH
  return {
    phase: "PREPARED" as const,
    stage,
    role: stage.toLowerCase(),
    resolved_model: { providerID: "openai", modelID: "gpt-5.2", variant: "high" },
    review_round: 1,
    attempt_number: 1,
    state_revision: 7,
    idempotency_key: key,
    profile_hash: HASH,
    prompt_hash: HASH,
    reference_hash: HASH,
    artifact_input_hash: HASH,
    child_title: `[openmath:${key}] ${stage.toLowerCase()} run-1 round 1`,
  }
}

function role(agent: string, outputAdapter: "opaque_markdown" | "review_verdict_markdown" | "full_replace_markdown", content: string) {
  return {
    agent,
    model: { providerID: "openai", modelID: "gpt-5.2", variant: "high" },
    prompt: { kind: "inline" as const, content },
    output_adapter: outputAdapter,
  }
}
