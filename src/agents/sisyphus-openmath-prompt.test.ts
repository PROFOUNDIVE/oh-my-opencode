import { describe, test, expect } from "bun:test";
import { createSisyphusAgent } from "./sisyphus";

const TEST_MODEL = "openai/gpt-5.2";

describe("Sisyphus OpenMath orchestrator prompt contract", () => {
  test("should encode OpenMath routing and loop guardrails", () => {
    //#given
    const agent = createSisyphusAgent(TEST_MODEL, []);

    //#when
    const prompt = agent.prompt;

    //#then
    expect(prompt).toContain("OpenMath session orchestrator");
    expect(prompt).toContain(
      "Prompt explicitly routes request classes: SETUP, PROBLEM, COACH, VERIFY, REVEAL, SOLVE_ONLY, EXPORT.",
    );
    expect(prompt).toContain(
      "Workflow: SOLVE -> REVIEW LOOP (max 3) -> FREEZE gate -> student attempt -> COACH -> VERIFY.",
    );
    expect(prompt).toContain("- SOLVE_ONLY:");
    expect(prompt).toContain("- EXPORT:");
    expect(prompt).toContain("- SOLVE_ONLY -> call openmath_solve_only");
    expect(prompt).toContain("- EXPORT -> call openmath_export");
    expect(prompt).toContain(
      "FAIL-CLOSED COACHING GATE: no problem-specific coaching unless artifacts are FROZEN with [CORRECT] certificate.",
    );
    expect(prompt).toContain(
      "Hidden reference-solution behavior: never print reference_solution unless the COACH reveal gate is satisfied.",
    );
    expect(prompt).toContain(
      "Freeze invalidation rule: post-freeze change -> DRAFT + review restart.",
    );
    expect(prompt).toContain(
      "Strict no-leak rule: do not print full reference_solution in normal coaching.",
    );
    expect(prompt).toContain(
      "COACH reveal gate: only after hint budget exhausted + explicit REVEAL request.",
    );
  });

  test("should name the 4 OpenMath agents and their @handles", () => {
    //#given
    const agent = createSisyphusAgent(TEST_MODEL, []);

    //#when
    const prompt = agent.prompt;

    //#then
    expect(prompt).toContain("You coordinate exactly 4 OpenMath agents:");
    expect(prompt).toContain("- @solver:");
    expect(prompt).toContain("- @reference-reviewer:");
    expect(prompt).toContain("- @coach:");
    expect(prompt).toContain("- @verifier:");
  });

  test("should require durable OpenMath state tools and a deterministic snapshot contract", () => {
    //#given
    const agent = createSisyphusAgent(TEST_MODEL, []);

    //#when
    const prompt = agent.prompt;

    //#then
    expect(prompt).toContain("You MUST use durable OpenMath state tools.");
    expect(prompt).toContain("You must not rely on implicit memory or chat memory.");

    expect(prompt).toContain("Required tools (use these exact names):");
    expect(prompt).toContain("openmath_state_get");
    expect(prompt).toContain("openmath_state_set");
    expect(prompt).toContain("openmath_state_reset");

    expect(prompt).toContain("Canonical processing steps (do this for EVERY user message):");
    expect(prompt).toContain("load state -> call openmath_state_get(session_id)");
    expect(prompt).toContain(
      "decide mode -> classify as SETUP | PROBLEM | COACH | VERIFY | REVEAL | SOLVE_ONLY | EXPORT",
    );
    expect(prompt).toContain("update state -> call openmath_state_set(state=<full snapshot>)");
    expect(prompt).toContain("proceed -> delegate to OpenMath agents or respond to the user");

    expect(prompt).toContain("Always read state at message start.");
    expect(prompt).toContain("Reset-on-new-problem behavior:");
    expect(prompt).toContain(
      "If class == PROBLEM, first call openmath_state_reset(session_id) to start a clean problem state.",
    );

    expect(prompt).toContain("Deterministic state snapshot contract (required keys and shape):");
    expect(prompt).toContain('"session_id": string');
    expect(prompt).toContain('"artifact_state": "DRAFT" | "FROZEN" | "UNFROZEN"');
    expect(prompt).toContain('"hint_budget_state": {');
    expect(prompt).toContain('"hints_used": number');
    expect(prompt).toContain(
      "- attempt_number: every VERIFY submission must increment a persisted attempt counter and pass it to @verifier as attempt_number.",
    );
    expect(prompt).toContain(
      "Store attempt_number deterministically in frozen_artifacts.hint_ladder.__orchestrator_state.attempt_number (number).",
    );
    expect(prompt).toContain(
      "every COACH turn that produces a hint must increment hint_budget_state.hints_used and persist it.",
    );
  });

  test("should use configurable max review rounds in REVIEW LOOP headers", () => {
    //#given
    const agent = createSisyphusAgent(TEST_MODEL, [], undefined, undefined, undefined, false, 5);

    //#when
    const prompt = agent.prompt;

    //#then
    expect(prompt).toContain("REVIEW LOOP (max 5)");
    expect(prompt).toContain(
      "Workflow: SOLVE -> REVIEW LOOP (max 5) -> FREEZE gate -> student attempt -> COACH -> VERIFY.",
    );
  });
});
