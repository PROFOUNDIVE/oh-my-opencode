const HASH = "a".repeat(64)

export function createWorkflowStateFixture() {
  return {
    schema_version: 1,
    run_id: "run-1",
    state_revision: 4,
    parent_session_id: "parent-session-immutable",
    status: "READY",
    next_stage: "REVIEW",
    awaiting_reason: null,
    abort_requested: false,
    abort_reason: null,
    blocked_reason: null,
    intervention_satisfied: false,
    review_round: 1,
    completed_review_rounds: 1,
    consecutive_passes: 1,
    artifact_version: 1,
    profile_snapshot: {
      name: "legacy-educational-json",
      solve: role("solver", "legacy_json_artifacts"),
      review: role("reference-reviewer", "review_verdict_json"),
      revise: role("solver", "legacy_json_artifacts"),
      min_review_rounds: 1,
      max_review_rounds: 3,
      required_consecutive_passes: 1,
      checkpoint: "none",
    },
    reference_snapshot: {
      version: 1,
      manifest: { kind: "legacy_supplementary" },
      references: [],
      diagnostics: [],
      sha256: HASH,
    },
    artifact: {
      version: 1,
      media_type: "application/vnd.openmath.legacy+json",
      content: JSON.stringify(frozenArtifacts()),
      sha256: HASH,
    },
    latest_review: {
      round: 1,
      verdict: "PASS",
      raw_report: "approved",
      raw_report_sha256: HASH,
      findings: [],
      checks_performed: ["proof"],
      session_id: "child-review",
      prompt_hash: HASH,
      reference_hash: HASH,
      artifact_input_hash: HASH,
    },
    review_history: [],
    amendments: [
      {
        event_type: "ADDED",
        amendment_id: "amendment-3",
        kind: "question",
        scope: "next_review",
        content: "Check the boundary case.",
        lifecycle: "ACTIVE",
        state_revision: 3,
      },
    ],
    stage_history: [
      {
        stage: "SOLVE",
        role: "solver",
        resolved_model: { providerID: "openai", modelID: "gpt-5" },
        review_round: 1,
        artifact_version: 1,
        outcome: "COMPLETED",
        state_revision: 2,
        attempt_key: HASH,
        profile_hash: HASH,
        prompt_hash: HASH,
        reference_hash: HASH,
        input_hash: HASH,
        output_hash: HASH,
        raw_session_id: "child-solve",
        raw_output: "solver output",
        parsed_result: { kind: "ARTIFACT", artifact: {
          version: 1,
          media_type: "application/vnd.openmath.legacy+json",
          content: JSON.stringify(frozenArtifacts()),
          sha256: HASH,
        } },
        parsed_error: null,
        error_code: null,
      },
    ],
    dispatch_attempts: [
      {
        phase: "PREPARED",
        stage: "SOLVE",
        role: "solver",
        review_round: 1,
        attempt_number: 1,
        state_revision: 1,
        idempotency_key: HASH,
        resolved_model: { providerID: "openai", modelID: "gpt-5" },
        profile_hash: HASH,
        prompt_hash: HASH,
        reference_hash: HASH,
        artifact_input_hash: HASH,
        child_title: `[openmath:${HASH}] solver run-1 round 1`,
      },
    ],
    legacy_projection: {
      kind: "solve_only",
      schema_version: 1,
      session_id: "legacy::problem-1",
      original_problem_text: "Solve x + 1 = 2.",
      artifact_state: "FROZEN",
      max_review_rounds: 3,
      hint_budget_state: { hints_used: 1, hint_budget: 3 },
      markdown_fallback: null,
    },
    legacy_source_hash: null,
  }
}

export function frozenArtifacts() {
  return {
    reference_solution: "Subtract 1 from both sides.",
    hint_ladder: {
      L1_nudge: "Isolate x.",
      L2_key_theorem: "Equality is preserved.",
      L3_skeleton: ["Subtract 1"],
      L4_full_solution: "Subtract 1 from both sides.",
    },
    grading_rubric: {
      premises_check: ["Equation supplied"],
      logical_steps: ["Subtract equally"],
      common_pitfalls: ["Subtract once"],
      key_theorem: "Equality",
      key_technique: "Inverse operations",
    },
    variant_problem: "Solve x + 2 = 3.",
    review_certificate: {
      artifact_version: "v1",
      review_round: 1,
      timestamp: "1970-01-01T00:00:00.000Z",
      verdict: "[CORRECT]",
    },
  }
}

function role(agent: string, outputAdapter: string) {
  return {
    agent,
    model: { providerID: "openai", modelID: "gpt-5" },
    prompt: { kind: "builtin" },
    output_adapter: outputAdapter,
  }
}
