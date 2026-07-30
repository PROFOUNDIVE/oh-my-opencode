import type { ToolDefinition } from "@opencode-ai/plugin/tool"

import {
  createOpenMathWorkflowAbortTool,
  OpenMathWorkflowAbortToolKey,
} from "./openmath-workflow-abort"
import {
  createOpenMathWorkflowAmendTool,
  OpenMathWorkflowAmendToolKey,
} from "./openmath-workflow-amend"
import {
  createOpenMathWorkflowReloadTool,
  OpenMathWorkflowReloadToolKey,
} from "./openmath-workflow-reload"
import {
  createOpenMathWorkflowStartTool,
  OpenMathWorkflowStartToolKey,
} from "./openmath-workflow-start"
import {
  createOpenMathWorkflowStatusTool,
  OpenMathWorkflowStatusToolKey,
} from "./openmath-workflow-status"
import {
  createOpenMathWorkflowStepTool,
  OpenMathWorkflowStepToolKey,
} from "./openmath-workflow-step"
import type { OpenMathWorkflowToolOptions } from "./openmath-workflow-shared"

export function createOpenMathWorkflowTools(
  options: OpenMathWorkflowToolOptions,
): Record<string, ToolDefinition> {
  return {
    [OpenMathWorkflowStartToolKey]: createOpenMathWorkflowStartTool(options),
    [OpenMathWorkflowStepToolKey]: createOpenMathWorkflowStepTool(options),
    [OpenMathWorkflowStatusToolKey]: createOpenMathWorkflowStatusTool(options),
    [OpenMathWorkflowAmendToolKey]: createOpenMathWorkflowAmendTool(options),
    [OpenMathWorkflowReloadToolKey]: createOpenMathWorkflowReloadTool(options),
    [OpenMathWorkflowAbortToolKey]: createOpenMathWorkflowAbortTool(options),
  }
}
