import type { CommandDefinition } from "../features/claude-code-command-loader/types"
import type { OhMyOpenCodeConfig } from "../config"

import {
  discoverConfigSourceSkills,
  discoverOpencodeGlobalSkills,
  discoverOpencodeProjectSkills,
  discoverProjectClaudeSkills,
  discoverUserClaudeSkills,
  skillsToCommandDefinitionRecord,
} from "../features/opencode-skill-loader"

import type { LoadedSkill } from "../features/opencode-skill-loader/types"

export async function discoverSkillSourcesForConfigHandler(params: {
  pluginConfig: OhMyOpenCodeConfig
  directory: string
}): Promise<{
  configSourceSkills: LoadedSkill[]
  userClaudeSkills: LoadedSkill[]
  projectClaudeSkills: LoadedSkill[]
  opencodeGlobalSkills: LoadedSkill[]
  opencodeProjectSkills: LoadedSkill[]
  commandSkillRecords: Record<string, CommandDefinition>
}> {
  const includeClaudeSkills = params.pluginConfig.claude_code?.skills ?? true

  const [
    configSourceSkills,
    userClaudeSkills,
    projectClaudeSkills,
    opencodeGlobalSkills,
    opencodeProjectSkills,
  ] = await Promise.all([
    discoverConfigSourceSkills({
      config: params.pluginConfig.skills,
      configDir: params.directory,
    }),
    includeClaudeSkills ? discoverUserClaudeSkills() : Promise.resolve([]),
    discoverProjectClaudeSkills(params.directory),
    discoverOpencodeGlobalSkills(),
    discoverOpencodeProjectSkills(params.directory),
  ])

  return {
    configSourceSkills,
    userClaudeSkills,
    projectClaudeSkills,
    opencodeGlobalSkills,
    opencodeProjectSkills,
    commandSkillRecords: skillsToCommandDefinitionRecord(configSourceSkills),
  }
}
