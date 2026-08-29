import { z } from "zod"

export const BuiltinCommandNameSchema = z.enum([
  "init-deep",
  "ralph-loop",
  "ulw-loop",
  "cancel-ralph",
  "refactor",
  "start-work",
  "stop-continuation",
  "handoff",
  "openmath-solve-only",
  "openmath-export",
  "openmath-workflow-start",
  "openmath-workflow-step",
  "openmath-workflow-status",
  "openmath-workflow-amend",
  "openmath-workflow-reload",
  "openmath-workflow-abort",
  "openmath-research-start",
  "openmath-research-status",
  "openmath-research-step",
  "openmath-research-amend",
  "openmath-research-promote",
  "openmath-research-abort",
])

export type BuiltinCommandName = z.infer<typeof BuiltinCommandNameSchema>
