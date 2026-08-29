import type { CommandDefinition } from "../claude-code-command-loader"
import type { OpenMathResearchCommandName } from "./types"
import { OPENMATH_RESEARCH_ABORT_TEMPLATE } from "./templates/openmath-research-abort"
import { OPENMATH_RESEARCH_AMEND_TEMPLATE } from "./templates/openmath-research-amend"
import { OPENMATH_RESEARCH_PROMOTE_TEMPLATE } from "./templates/openmath-research-promote"
import { OPENMATH_RESEARCH_START_TEMPLATE } from "./templates/openmath-research-start"
import { OPENMATH_RESEARCH_STATUS_TEMPLATE } from "./templates/openmath-research-status"
import { OPENMATH_RESEARCH_STEP_TEMPLATE } from "./templates/openmath-research-step"

export const OPENMATH_RESEARCH_COMMAND_DEFINITIONS = {
  "openmath-research-start": commandDefinition(
    "(builtin) Start an OpenMath research campaign",
    OPENMATH_RESEARCH_START_TEMPLATE,
    '{"campaign_id":"campaign-1","objective":{"kind":"markdown","instruction":"Prove it."}}',
  ),
  "openmath-research-status": commandDefinition(
    "(builtin) Read OpenMath research campaign status",
    OPENMATH_RESEARCH_STATUS_TEMPLATE,
    '{"campaign_id":"campaign-1"}',
  ),
  "openmath-research-step": commandDefinition(
    "(builtin) Execute an OpenMath research campaign operation",
    OPENMATH_RESEARCH_STEP_TEMPLATE,
    '{"campaign_id":"campaign-1","expected_state_revision":0,"mode":"one_stage"}',
  ),
  "openmath-research-amend": commandDefinition(
    "(builtin) Amend an OpenMath research campaign",
    OPENMATH_RESEARCH_AMEND_TEMPLATE,
    '{"campaign_id":"campaign-1","expected_state_revision":0,"operation":"add","kind":"required_check","scope":"all_candidates","content":"Check it."}',
  ),
  "openmath-research-promote": commandDefinition(
    "(builtin) Record a promotion-ready metadata decision",
    OPENMATH_RESEARCH_PROMOTE_TEMPLATE,
    '{"campaign_id":"campaign-1","expected_state_revision":9,"dossier_sha256":"<sha256>","decision":"approve"}',
  ),
  "openmath-research-abort": commandDefinition(
    "(builtin) Abort an OpenMath research campaign",
    OPENMATH_RESEARCH_ABORT_TEMPLATE,
    '{"campaign_id":"campaign-1","expected_state_revision":0}',
  ),
} satisfies Record<OpenMathResearchCommandName, Omit<CommandDefinition, "name">>

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
