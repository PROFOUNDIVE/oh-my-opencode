import type { OhMyOpenCodeConfig, OpenMathConfig } from "./schema"
import { resolveWorkflowProfilePromptSources } from "../openmath/workflow"

export function resolveWorkflowProfileConfigSources(
  config: OhMyOpenCodeConfig,
  baseDirectory: string,
): OhMyOpenCodeConfig {
  if (!config.openmath) return config

  return {
    ...config,
    openmath: resolveOpenMathWorkflowProfileSources(config.openmath, baseDirectory),
  }
}

function resolveOpenMathWorkflowProfileSources(
  config: OpenMathConfig,
  baseDirectory: string,
): OpenMathConfig {
  return {
    ...config,
    workflow_profiles: resolveWorkflowProfilePromptSources(config.workflow_profiles, baseDirectory),
  }
}
