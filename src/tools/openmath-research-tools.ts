import type { ToolDefinition } from "@opencode-ai/plugin/tool"

import {
  createOpenMathResearchAbortTool,
  OpenMathResearchAbortToolKey,
} from "./openmath-research-abort"
import {
  createOpenMathResearchAmendTool,
  OpenMathResearchAmendToolKey,
} from "./openmath-research-amend"
import {
  createOpenMathResearchPromoteTool,
  OpenMathResearchPromoteToolKey,
} from "./openmath-research-promote"
import {
  createOpenMathResearchStartTool,
  OpenMathResearchStartToolKey,
} from "./openmath-research-start"
import {
  createOpenMathResearchStatusTool,
  OpenMathResearchStatusToolKey,
} from "./openmath-research-status"
import {
  createOpenMathResearchStepTool,
  OpenMathResearchStepToolKey,
} from "./openmath-research-step"
import type { OpenMathResearchToolOptions } from "./openmath-research-shared"
import {
  createOpenMathResearchEducationalizeTool,
  OpenMathResearchEducationalizeToolKey,
} from "./openmath-research-educationalize"

export function createOpenMathResearchTools(
  options: OpenMathResearchToolOptions,
): Record<string, ToolDefinition> {
  return {
    [OpenMathResearchStartToolKey]: createOpenMathResearchStartTool(options),
    [OpenMathResearchStatusToolKey]: createOpenMathResearchStatusTool(options),
    [OpenMathResearchStepToolKey]: createOpenMathResearchStepTool(options),
    [OpenMathResearchAmendToolKey]: createOpenMathResearchAmendTool(options),
    [OpenMathResearchPromoteToolKey]: createOpenMathResearchPromoteTool(options),
    [OpenMathResearchEducationalizeToolKey]: createOpenMathResearchEducationalizeTool(options),
    [OpenMathResearchAbortToolKey]: createOpenMathResearchAbortTool(options),
  }
}
