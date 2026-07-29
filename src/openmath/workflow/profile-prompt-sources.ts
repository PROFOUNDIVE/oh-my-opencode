import { resolveReplacementPrompt } from "../../agents/builtin-agents/replacement-prompt-resolver"
import {
  setWorkflowFilePromptProvenance,
  type WorkflowFilePromptProvenance,
} from "./prompt-source"
import type { WorkflowProfile, WorkflowProfiles } from "./profile-schema"
import type { WorkflowRoleSettings } from "./role-settings"

export function resolveWorkflowProfilePromptSources(
  profiles: WorkflowProfiles,
  baseDirectory: string,
): WorkflowProfiles {
  return Object.fromEntries(
    Object.entries(profiles).map(([name, profile]) => [name, resolveProfile(profile, baseDirectory)]),
  )
}

function resolveProfile(profile: WorkflowProfile, baseDirectory: string): WorkflowProfile {
  return {
    ...profile,
    solve: resolveRole(profile.solve, baseDirectory),
    review: resolveRole(profile.review, baseDirectory),
    revise: resolveRole(profile.revise, baseDirectory),
  }
}

function resolveRole(role: WorkflowRoleSettings, baseDirectory: string): WorkflowRoleSettings {
  if (role.prompt.kind !== "file") return role

  const resolved = resolveReplacementPrompt(role.prompt.uri, baseDirectory)
  const materializedRole = { ...role }
  setWorkflowFilePromptProvenance(materializedRole, toProvenance(resolved, baseDirectory))
  return materializedRole
}

function toProvenance(
  resolved: ReturnType<typeof resolveReplacementPrompt>,
  baseDirectory: string,
): WorkflowFilePromptProvenance {
  return {
    original_uri: resolved.uri,
    base_dir: baseDirectory,
    resolved_path: resolved.path,
    canonical_path: resolved.canonicalPath,
    content: resolved.content,
    content_hash: resolved.sha256,
  }
}
