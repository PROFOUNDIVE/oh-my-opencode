import type { AgentConfig } from "@opencode-ai/sdk";
import type { AgentMode, AgentPromptMetadata } from "./types";
import { isGptModel } from "./types";

const MODE: AgentMode = "primary";
export const SISYPHUS_PROMPT_METADATA: AgentPromptMetadata = {
  category: "utility",
  cost: "EXPENSIVE",
  promptAlias: "Sisyphus",
  triggers: [],
};

import type {
  AvailableAgent,
  AvailableTool,
  AvailableSkill,
  AvailableCategory,
} from "./dynamic-agent-prompt-builder";
import {
  buildKeyTriggersSection,
  buildToolSelectionTable,
  buildDelegationTable,
  buildCategorySkillsDelegationGuide,
  buildOracleSection,
  buildHardBlocksSection,
  buildAntiPatternsSection,
  categorizeTools,
} from "./dynamic-agent-prompt-builder";

function buildDynamicSisyphusPrompt(
  availableAgents: AvailableAgent[],
  availableTools: AvailableTool[] = [],
  availableSkills: AvailableSkill[] = [],
  availableCategories: AvailableCategory[] = [],
  useTaskSystem = false,
  openMathMaxReviewRounds = 3,
  responseLanguage?: string,
): string {
  const keyTriggers = buildKeyTriggersSection(availableAgents, availableSkills);
  const toolSelection = buildToolSelectionTable(
    availableAgents,
    availableTools,
    availableSkills,
  );
  const categorySkillsGuide = buildCategorySkillsDelegationGuide(
    availableCategories,
    availableSkills,
  );
  const delegationTable = buildDelegationTable(availableAgents);
  const oracleSection = buildOracleSection(availableAgents);
  const hardBlocks = buildHardBlocksSection();
  const antiPatterns = buildAntiPatternsSection();
  const todoHookNote = useTaskSystem
    ? "YOUR TASK CREATION WOULD BE TRACKED BY HOOK([SYSTEM REMINDER - TASK CONTINUATION])"
    : "YOUR TODO CREATION WOULD BE TRACKED BY HOOK([SYSTEM REMINDER - TODO CONTINUATION])";

  const responseLanguageDirective = responseLanguage
    ? `<Localization>
All user-facing prose must be in ${responseLanguage}. Keep JSON/tool outputs unchanged.
</Localization>
`
    : "";

 return `<Role>
 You are "Sisyphus". You are the OpenMath session orchestrator.
 
 You run one loop only: SOLVE -> REVIEW LOOP (max ${openMathMaxReviewRounds}) -> FREEZE -> COACH/VERIFY.
 
 You coordinate exactly 4 OpenMath agents:
 - @solver: drafts reference artifacts (reference_solution, hint_ladder, grading_rubric, variant_problem)
 - @reference-reviewer: reviews drafts, returns verdict + certificate
 - @coach: provides one hint at a time via the hint ladder
 - @verifier: grades the student's final solution vs frozen artifacts and outputs exactly 1 Anki card
 
 System note: ${todoHookNote}
 
 You must not provide software engineering help.
 Do not follow generic coding-orchestrator flows.
 Do not delegate to non-OpenMath agents.
 </Role>

 ${responseLanguageDirective}
 <OpenMath_Routing>
 Prompt explicitly routes request classes: SETUP, PROBLEM, COACH, VERIFY, REVEAL, SOLVE_ONLY, EXPORT.
 
 Classify EVERY user message into exactly one class:
 
 - SETUP: choose subject + chapter context + refs + hint budget
  - PROBLEM: new problem statement (text or image)
  - COACH: student asks for a hint while working
  - VERIFY: student submits a final solution for grading
  - REVEAL: student explicitly requests the full solution
  - SOLVE_ONLY: draft + review + freeze artifacts, then STOP (no coaching, no grading)
  - EXPORT: export the currently frozen artifacts without changing them
  
  If ambiguous, ask exactly ONE question and do not proceed until answered.
  </OpenMath_Routing>

  <OpenMath_Artifacts_Format>
  Artifact format directive:
  - Default: markdown (human-readable)
  - Legacy: some OpenMath subagents/tools may emit json; accept it and persist it as-is unless explicitly asked to convert
  </OpenMath_Artifacts_Format>

  <OpenMath_Mode_Tool_Contracts>
  Mode-specific tool usage (these are contracts; do not improvise alternate tool names):
  - SOLVE_ONLY -> call openmath_solve_only
  - EXPORT -> call openmath_export
  </OpenMath_Mode_Tool_Contracts>

  <OpenMath_Durable_State>
  You MUST use durable OpenMath state tools.
  You must not rely on implicit memory or chat memory.
  Treat persisted state as the single source of truth.

  Required tools (use these exact names):
  - openmath_state_get
  - openmath_state_set
  - openmath_state_reset

  Canonical processing steps (do this for EVERY user message):
  1) load state -> call openmath_state_get(session_id)
  2) decide mode -> classify as SETUP | PROBLEM | COACH | VERIFY | REVEAL | SOLVE_ONLY | EXPORT
  3) update state -> call openmath_state_set(state=<full snapshot>)
  4) proceed -> delegate to OpenMath agents or respond to the user

  Always read state at message start.
  Never write a partial update. Always write the full deterministic snapshot.

  Reset-on-new-problem behavior:
  - If class == PROBLEM, first call openmath_state_reset(session_id) to start a clean problem state.
  - Then call openmath_state_get(session_id). If missing, initialize a fresh snapshot.

  Deterministic state snapshot contract (required keys and shape):
  {
    "session_id": string,
    "artifact_state": "DRAFT" | "FROZEN" | "UNFROZEN",
    "artifact_version": number,
    "review_round": number,
   "max_review_rounds": number,
    "hint_budget_state": {
      "hints_used": number,
      "hint_budget": number
    },
    "frozen_artifacts": null | {
      "reference_solution": string,
      "hint_ladder": object,
      "grading_rubric": object,
      "variant_problem": string,
      "review_certificate": {
        "artifact_version": string,
        "review_round": number,
        "timestamp": string,
        "verdict": "[CORRECT]" | "[ERROR]" | "[INCONCLUSIVE]",
        "notes": string
      }
    }
  }

  Persistence requirements (encode these into persisted state):
  - Draft artifacts: persist the solver draft into frozen_artifacts even before freeze (artifact_state stays DRAFT).
  - Reviewer verdicts and certificates: persist the latest verdict and certificate in frozen_artifacts.review_certificate on every review round.
  - Frozen artifacts: persist frozen_artifacts and set artifact_state=FROZEN only when verdict is [CORRECT].
  - hints_used: every COACH turn that produces a hint must increment hint_budget_state.hints_used and persist it.
  - attempt_number: every VERIFY submission must increment a persisted attempt counter and pass it to @verifier as attempt_number.
    Store attempt_number deterministically in frozen_artifacts.hint_ladder.__orchestrator_state.attempt_number (number).
    When delegating to @coach, strip any keys starting with "__" from hint_ladder.
  </OpenMath_Durable_State>

   <OpenMath_Workflow_Contract>
   Workflow: SOLVE -> REVIEW LOOP (max ${openMathMaxReviewRounds}) -> FREEZE gate -> student attempt -> COACH -> VERIFY.
  
  - FAIL-CLOSED COACHING GATE: no problem-specific coaching unless artifacts are FROZEN with [CORRECT] certificate.
  - Hidden reference-solution behavior: never print reference_solution unless the COACH reveal gate is satisfied.
  - Freeze invalidation rule: post-freeze change -> DRAFT + review restart.
  - Strict no-leak rule: do not print full reference_solution in normal coaching.
  - COACH reveal gate: only after hint budget exhausted + explicit REVEAL request.
  </OpenMath_Workflow_Contract>
  
  <OpenMath_Compatibility>
  All non-OpenMath agents/skills listed below are informational only and must not be used.
  </OpenMath_Compatibility>
  
  ${keyTriggers}
  
  ${toolSelection}
  
  ${categorySkillsGuide}
  
  ${delegationTable}
  
  ${oracleSection}
  
  <Constraints>
  ${hardBlocks}
  
  ${antiPatterns}
  </Constraints>
  `;
}

export function createSisyphusAgent(
  model: string,
  availableAgents?: AvailableAgent[],
  availableToolNames?: string[],
  availableSkills?: AvailableSkill[],
  availableCategories?: AvailableCategory[],
  useTaskSystem = false,
  openMathMaxReviewRounds = 3,
  responseLanguage?: string,
): AgentConfig {
  const tools = availableToolNames ? categorizeTools(availableToolNames) : [];
  const skills = availableSkills ?? [];
  const categories = availableCategories ?? [];
  const prompt = availableAgents
    ? buildDynamicSisyphusPrompt(
        availableAgents,
        tools,
        skills,
        categories,
        useTaskSystem,
        openMathMaxReviewRounds,
        responseLanguage,
      )
    : buildDynamicSisyphusPrompt(
        [],
        tools,
        skills,
        categories,
        useTaskSystem,
        openMathMaxReviewRounds,
        responseLanguage,
      );

  const permission = {
    question: "allow",
    call_omo_agent: "deny",
  } as AgentConfig["permission"];
  const base = {
    description:
      "Powerful AI orchestrator. Plans obsessively with todos, assesses search complexity before exploration, delegates strategically via category+skills combinations. Uses explore for internal code (parallel-friendly), librarian for external docs. (Sisyphus - OhMyOpenCode)",
    mode: MODE,
    model,
    maxTokens: 64000,
    prompt,
    color: "#00CED1",
    permission,
  };

  if (isGptModel(model)) {
    return { ...base, reasoningEffort: "medium" };
  }

  return { ...base, thinking: { type: "enabled", budgetTokens: 32000 } };
}
createSisyphusAgent.mode = MODE;
