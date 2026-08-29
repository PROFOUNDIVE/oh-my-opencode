import type { CommandDefinition } from "../claude-code-command-loader"

export type OpenMathWorkflowCommandName =
  | "openmath-workflow-start"
  | "openmath-workflow-step"
  | "openmath-workflow-status"
  | "openmath-workflow-amend"
  | "openmath-workflow-reload"
  | "openmath-workflow-abort"

export type OpenMathResearchCommandName =
  | "openmath-research-start"
  | "openmath-research-status"
  | "openmath-research-step"
  | "openmath-research-amend"
  | "openmath-research-promote"
  | "openmath-research-abort"

export type BuiltinCommandName =
  | "init-deep"
  | "ralph-loop"
  | "cancel-ralph"
  | "ulw-loop"
  | "refactor"
  | "start-work"
  | "stop-continuation"
  | "handoff"
  | "openmath-solve-only"
  | "openmath-export"
  | OpenMathResearchCommandName
  | OpenMathWorkflowCommandName

export interface BuiltinCommandConfig {
  disabled_commands?: BuiltinCommandName[]
}

export type BuiltinCommands = Record<string, CommandDefinition>
