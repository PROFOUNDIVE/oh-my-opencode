import { z } from "zod"

export const BuiltinAgentNameSchema = z.enum([
  "sisyphus",
  "multimodal-looker",
  "solver",
  "reference-reviewer",
  "verifier",
  "coach",
])

export const BuiltinSkillNameSchema = z.enum([
  "playwright",
  "agent-browser",
  "dev-browser",
  "frontend-ui-ux",
  "git-master",
])

export const OverridableAgentNameSchema = z.enum([
  "build",
  "plan",
  "sisyphus",
  "sisyphus-junior",
  "OpenCode-Builder",
  "prometheus",
  "multimodal-looker",
  "solver",
  "solver-markdown",
  "solver-markdown-patch",
  "reference-reviewer",
  "reference-reviewer-markdown",
  "reference-reviewer-patch",
  "verifier",
  "coach",
])

export const AgentNameSchema = BuiltinAgentNameSchema
export type AgentName = z.infer<typeof AgentNameSchema>

export type BuiltinSkillName = z.infer<typeof BuiltinSkillNameSchema>
