import { z } from "zod"

export const WorkflowAdapterNameSchema = z.enum([
  "legacy_omo_sections",
  "legacy_json_artifacts",
  "opaque_markdown",
  "review_verdict_json",
  "review_verdict_markdown",
  "patch_set_json",
  "full_replace_markdown",
])

export const WorkflowStageNameSchema = z.enum(["solve", "review", "revise"])

export type WorkflowAdapterName = z.infer<typeof WorkflowAdapterNameSchema>
export type WorkflowStageName = z.infer<typeof WorkflowStageNameSchema>

const SOLVE_ADAPTERS: readonly WorkflowAdapterName[] = [
  "legacy_omo_sections",
  "legacy_json_artifacts",
  "opaque_markdown",
]
const REVIEW_ADAPTERS: readonly WorkflowAdapterName[] = ["review_verdict_json", "review_verdict_markdown"]
const REVISE_ADAPTERS: readonly WorkflowAdapterName[] = [
  "patch_set_json",
  "full_replace_markdown",
  "legacy_json_artifacts",
]

export function isWorkflowAdapterAllowed(
  stage: WorkflowStageName,
  adapter: WorkflowAdapterName,
): boolean {
  switch (stage) {
    case "solve":
      return SOLVE_ADAPTERS.includes(adapter)
    case "review":
      return REVIEW_ADAPTERS.includes(adapter)
    case "revise":
      return REVISE_ADAPTERS.includes(adapter)
  }
}

export function workflowAdapterRoleMessage(stage: WorkflowStageName): string {
  switch (stage) {
    case "solve":
      return "SOLVE output_adapter must be legacy_omo_sections, legacy_json_artifacts, or opaque_markdown"
    case "review":
      return "REVIEW output_adapter must be review_verdict_json or review_verdict_markdown"
    case "revise":
      return "REVISE output_adapter must be patch_set_json, full_replace_markdown, or legacy_json_artifacts"
  }
}
