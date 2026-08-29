import { OpenMathConfigSchema, type OpenMathConfig } from "../config/schema"
import type { ToolContextWithMetadata } from "./delegate-task/types"

export function researchToolContext(
  sessionID = "ses_human1",
  messageID = "msg_human1",
): ToolContextWithMetadata {
  return {
    sessionID,
    messageID,
    agent: "test",
    abort: new AbortController().signal,
  }
}

export function researchToolConfig(): OpenMathConfig {
  return OpenMathConfigSchema.parse({
    default_research_profile: "phase-a",
    workflow_profiles: {
      candidate: {
        solve: role("opaque_markdown"),
        review: role("review_verdict_json"),
        revise: role("patch_set_json"),
        min_review_rounds: 1,
        max_review_rounds: 2,
        required_consecutive_passes: 1,
        checkpoint: "after_solve",
      },
    },
    research_profiles: {
      "phase-a": {
        candidate_workflow_profile: "candidate",
        strategies: [
          { id: "direct", prompt: { kind: "inline", content: "Direct proof." } },
          { id: "contradiction", prompt: { kind: "inline", content: "Contradiction proof." } },
        ],
        candidates_per_strategy: 1,
        screening_roles: [{
          id: "screen",
          agent: "screen-agent",
          model: "openai/gpt-5",
          prompt: { kind: "inline", content: "Screen it." },
        }],
        max_active_candidates: 1,
        survivor_limit: 1,
        tournament_role: {
          agent: "tournament-agent",
          model: "openai/gpt-5",
          prompt: { kind: "inline", content: "Choose categorically." },
        },
      },
    },
  })
}

function role(output_adapter: "opaque_markdown" | "review_verdict_json" | "patch_set_json") {
  return {
    agent: "solver",
    model: "openai/gpt-5",
    prompt: { kind: "inline" as const, content: "Work." },
    output_adapter,
  }
}
