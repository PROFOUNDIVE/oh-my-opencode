import { relative, sep, isAbsolute } from "node:path"

import type { OpenMathConfig } from "../../config/schema"
import { resolveReplacementPrompt } from "../../agents/builtin-agents/replacement-prompt-resolver"
import { resolveAllowedRoots } from "../../openmath/references/path-resolver"
import {
  findBuiltinWorkflowProfile,
  legacyWorkflowProfileName,
  resolveWorkflowProfileSnapshot,
  WorkflowProfileResolutionError,
} from "../../openmath/workflow"
import { resolveWorkflowRoleModels } from "../../openmath/workflow/stage-runner"
import type { AgentOverrides } from "../../config/schema"
import type { OpencodeClient } from "../delegate-task/types"
import { WorkflowProfileSnapshotSchema, type WorkflowStateV1 } from "../../openmath/workflow/state"

export async function resolveInitialProfileSnapshot(input: Readonly<{
  readonly config: OpenMathConfig
  readonly directory: string
  readonly profile_name?: string
  readonly client?: OpencodeClient
  readonly plugin_agents?: AgentOverrides
}>): Promise<WorkflowStateV1["profile_snapshot"]> {
  const name = input.profile_name
    ?? input.config.default_workflow_profile
    ?? legacyWorkflowProfileName(input.config.artifacts.format)
  const profile = input.config.workflow_profiles[name] ?? findBuiltinWorkflowProfile(name, input.config.max_review_rounds)
  if (!profile) throw new WorkflowProfileResolutionError("profile_not_found", name)
  const models = await resolveWorkflowRoleModels({
    client: input.client,
    plugin_agents: input.plugin_agents,
    roles: profile,
  })
  const snapshot = resolveWorkflowProfileSnapshot({
    config: input.config,
    profile_name: name,
    resolveAgentModel: (agent) => modelForAgent(profile, models, agent),
  })
  assertPromptRoots(snapshot, input.config, input.directory)
  return WorkflowProfileSnapshotSchema.parse({ ...snapshot, snapshot_version: 1 })
}

export function reloadProfileSnapshot(input: Readonly<{
  readonly snapshot: WorkflowStateV1["profile_snapshot"]
  readonly config: OpenMathConfig
  readonly directory: string
}>): WorkflowStateV1["profile_snapshot"] {
  const snapshot = input.snapshot
  const reloaded = {
    ...snapshot,
    snapshot_version: snapshot.snapshot_version + 1,
    solve: reloadRole(snapshot.solve),
    review: reloadRole(snapshot.review),
    revise: reloadRole(snapshot.revise),
  }
  assertPromptRoots(reloaded, input.config, input.directory)
  return WorkflowProfileSnapshotSchema.parse(reloaded)
}

function modelForAgent(
  profile: Readonly<{ readonly solve: { readonly agent: string }; readonly review: { readonly agent: string }; readonly revise: { readonly agent: string } }>,
  models: Awaited<ReturnType<typeof resolveWorkflowRoleModels>>,
  agent: string,
): Awaited<ReturnType<typeof resolveWorkflowRoleModels>>["solve"] {
  if (profile.solve.agent === agent) return models.solve
  if (profile.review.agent === agent) return models.review
  if (profile.revise.agent === agent) return models.revise
  throw new WorkflowProfileResolutionError("invalid_explicit_model", agent)
}

function reloadRole(role: WorkflowStateV1["profile_snapshot"]["solve"]): WorkflowStateV1["profile_snapshot"]["solve"] {
  switch (role.prompt.kind) {
    case "builtin":
    case "inline":
      return role
    case "file": {
      const prompt = resolveReplacementPrompt(role.prompt.original_uri, role.prompt.base_dir)
      return {
        ...role,
        prompt: {
          kind: "file",
          original_uri: prompt.uri,
          base_dir: role.prompt.base_dir,
          resolved_path: prompt.path,
          canonical_path: prompt.canonicalPath,
          content: prompt.content,
          content_hash: prompt.sha256,
        },
      }
    }
    default:
      return assertNever(role.prompt)
  }
}

function assertPromptRoots(
  snapshot: Pick<WorkflowStateV1["profile_snapshot"], "solve" | "review" | "revise">,
  config: OpenMathConfig,
  directory: string,
): void {
  const roots = resolveAllowedRoots({ projectDirectory: directory, configuredRoots: config.workflow_allowed_roots })
  for (const role of [snapshot.solve, snapshot.review, snapshot.revise]) {
    const prompt = role.prompt
    if (prompt.kind !== "file") continue
    if (!roots.canonicalPaths.some((root) => isInside(root, prompt.canonical_path))) {
      throw new WorkflowProfileResolutionError("invalid_explicit_model", `prompt outside workflow_allowed_roots: ${prompt.canonical_path}`)
    }
  }
}

function isInside(root: string, candidate: string): boolean {
  const value = relative(root, candidate)
  return value === "" || (!value.startsWith(`..${sep}`) && value !== ".." && !isAbsolute(value))
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected prompt source: ${String(value)}`)
}
