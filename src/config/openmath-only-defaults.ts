import { HookNameSchema } from "./schema"

import type { AgentName, HookName, OhMyOpenCodeConfig } from "./schema"

const OPENMATH_AGENT_ALLOWLIST = new Set([
  "sisyphus",
  "solver",
  "reference-reviewer",
  "verifier",
  "coach",
  "multimodal-looker",
])

const BUILTIN_AGENT_NAMES: readonly AgentName[] = [
  "sisyphus",
  "multimodal-looker",
  "solver",
  "reference-reviewer",
  "verifier",
  "coach",
]

const OPENMATH_DISABLED_TOOLS_DEFAULT = [
  "lsp_goto_definition",
  "lsp_find_references",
  "lsp_symbols",
  "lsp_diagnostics",
  "lsp_prepare_rename",
  "lsp_rename",
  "ast_grep_search",
  "ast_grep_replace",
  "grep",
  "glob",
  "session_list",
  "session_read",
  "session_search",
  "session_info",
  "call_omo_agent",
  "skill",
  "skill_mcp",
  "slashcommand",
  "interactive_bash",
  "task_create",
  "task_get",
  "task_list",
  "task_update",
  "hashline_edit",
]

const OPENMATH_ENABLED_HOOKS_DEFAULT: readonly HookName[] = ["background-notification"]

const OPENMATH_DISABLED_HOOKS_DEFAULT: readonly HookName[] = HookNameSchema.options.filter(
  (hookName) => !OPENMATH_ENABLED_HOOKS_DEFAULT.includes(hookName),
)

function mergeStringLists<T extends string>(
  base: readonly T[] | undefined,
  defaults: readonly T[],
): T[] {
  return [...new Set([...(base ?? []), ...defaults])]
}

export function applyOpenMathOnlyDefaults(config: OhMyOpenCodeConfig): OhMyOpenCodeConfig {
  const defaultDisabledAgents = BUILTIN_AGENT_NAMES.filter(
    (agentName) => !OPENMATH_AGENT_ALLOWLIST.has(agentName),
  )

  return {
    ...config,
    disabled_agents: mergeStringLists(config.disabled_agents, defaultDisabledAgents),
    disabled_tools: mergeStringLists(config.disabled_tools, OPENMATH_DISABLED_TOOLS_DEFAULT),
    disabled_hooks: mergeStringLists(config.disabled_hooks, OPENMATH_DISABLED_HOOKS_DEFAULT),
  }
}
