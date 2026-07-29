import type { WorkflowProfile } from "./profile-schema"
import type { PromptSource } from "./prompt-source"
import type { WorkflowRoleSettings } from "./role-settings"

const LEGACY_MARKDOWN_PROFILE = "legacy-educational-markdown"
const LEGACY_JSON_PROFILE = "legacy-educational-json"

export type LegacyWorkflowProfileName =
  | typeof LEGACY_MARKDOWN_PROFILE
  | typeof LEGACY_JSON_PROFILE

export function createBuiltinWorkflowProfiles(
  maxReviewRounds: number,
): Readonly<Record<LegacyWorkflowProfileName, WorkflowProfile>> {
  return Object.freeze({
    [LEGACY_MARKDOWN_PROFILE]: freezeProfile({
      solve: legacyRole("solver-markdown", "legacy_omo_sections"),
      review: legacyRole("reference-reviewer-markdown", "review_verdict_json"),
      revise: legacyRole("solver-markdown-patch", "patch_set_json"),
      min_review_rounds: 1,
      max_review_rounds: maxReviewRounds,
      required_consecutive_passes: 1,
      checkpoint: "none",
    }),
    [LEGACY_JSON_PROFILE]: freezeProfile({
      solve: legacyRole("solver", "legacy_json_artifacts"),
      review: legacyRole("reference-reviewer", "review_verdict_json"),
      revise: legacyRole("solver", "legacy_json_artifacts"),
      min_review_rounds: 1,
      max_review_rounds: maxReviewRounds,
      required_consecutive_passes: 1,
      checkpoint: "none",
    }),
  })
}

export function legacyWorkflowProfileName(format: "markdown" | "json"): LegacyWorkflowProfileName {
  return format === "markdown" ? LEGACY_MARKDOWN_PROFILE : LEGACY_JSON_PROFILE
}

export function findBuiltinWorkflowProfile(
  name: string,
  maxReviewRounds: number,
): WorkflowProfile | undefined {
  const profiles = createBuiltinWorkflowProfiles(maxReviewRounds)
  if (name === LEGACY_MARKDOWN_PROFILE) return profiles[LEGACY_MARKDOWN_PROFILE]
  if (name === LEGACY_JSON_PROFILE) return profiles[LEGACY_JSON_PROFILE]
  return undefined
}

function legacyRole(
  agent: string,
  outputAdapter: WorkflowRoleSettings["output_adapter"],
): WorkflowRoleSettings {
  return {
    agent,
    prompt: { kind: "builtin" },
    output_adapter: outputAdapter,
  }
}

function freezeProfile(profile: WorkflowProfile): WorkflowProfile {
  return Object.freeze({
    ...profile,
    solve: freezeRole(profile.solve),
    review: freezeRole(profile.review),
    revise: freezeRole(profile.revise),
  })
}

function freezeRole(role: WorkflowRoleSettings): WorkflowRoleSettings {
  return Object.freeze({ ...role, prompt: freezePromptSource(role.prompt) })
}

function freezePromptSource(source: PromptSource): PromptSource {
  switch (source.kind) {
    case "builtin":
      return Object.freeze({ kind: "builtin" })
    case "inline":
      return Object.freeze({ kind: "inline", content: source.content })
    case "file":
      return Object.freeze({ kind: "file", uri: source.uri })
  }
}
