import type { CommandDefinition } from "../claude-code-command-loader"
import type { OpenMathWorkflowCommandName } from "./types"
import { OPENMATH_WORKFLOW_ABORT_TEMPLATE } from "./templates/openmath-workflow-abort"
import { OPENMATH_WORKFLOW_AMEND_TEMPLATE } from "./templates/openmath-workflow-amend"
import { OPENMATH_WORKFLOW_RELOAD_TEMPLATE } from "./templates/openmath-workflow-reload"
import { OPENMATH_WORKFLOW_START_TEMPLATE } from "./templates/openmath-workflow-start"
import { OPENMATH_WORKFLOW_STATUS_TEMPLATE } from "./templates/openmath-workflow-status"
import { OPENMATH_WORKFLOW_STEP_TEMPLATE } from "./templates/openmath-workflow-step"

export const OPENMATH_WORKFLOW_COMMAND_DEFINITIONS = {
  "openmath-workflow-start": commandDefinition(
    "(builtin) Start an OpenMath workflow run",
    OPENMATH_WORKFLOW_START_TEMPLATE,
    '{"run_id":"run-1","request":{"kind":"problem","source":{"kind":"text","text":"Prove it."}}}',
  ),
  "openmath-workflow-step": commandDefinition(
    "(builtin) Execute an OpenMath workflow stage",
    OPENMATH_WORKFLOW_STEP_TEMPLATE,
    '{"run_id":"run-1","expected_state_revision":0,"mode":"one_stage"}',
  ),
  "openmath-workflow-status": commandDefinition(
    "(builtin) Read OpenMath workflow status",
    OPENMATH_WORKFLOW_STATUS_TEMPLATE,
    '{"run_id":"run-1"}',
  ),
  "openmath-workflow-amend": commandDefinition(
    "(builtin) Amend an OpenMath workflow run",
    OPENMATH_WORKFLOW_AMEND_TEMPLATE,
    '{"run_id":"run-1","expected_state_revision":0,"operation":"add","kind":"required_check","scope":"next_review","content":"Check the proof."}',
  ),
  "openmath-workflow-reload": commandDefinition(
    "(builtin) Reload OpenMath workflow sources",
    OPENMATH_WORKFLOW_RELOAD_TEMPLATE,
    '{"run_id":"run-1","expected_state_revision":0,"targets":["prompts"]}',
  ),
  "openmath-workflow-abort": commandDefinition(
    "(builtin) Abort an OpenMath workflow run",
    OPENMATH_WORKFLOW_ABORT_TEMPLATE,
    '{"run_id":"run-1","expected_state_revision":0}',
  ),
} satisfies Record<OpenMathWorkflowCommandName, Omit<CommandDefinition, "name">>

function commandDefinition(
  description: string,
  instruction: string,
  argumentHint: string,
): Omit<CommandDefinition, "name"> {
  return {
    description,
    template: `<command-instruction>
${instruction}
</command-instruction>

<user-request>
$ARGUMENTS
</user-request>`,
    argumentHint,
  }
}
