import type { AgentOverrides } from "../../../config/schema"
import type { OpencodeClient } from "../../../tools/delegate-task/types"
import { resolveWorkflowRoleModels } from "../../workflow/stage-runner"
import { WorkflowProfileSnapshotSchema, type WorkflowStateV1 } from "../../workflow/state"
import {
  GENERATE_EDUCATIONAL_ARTIFACTS_PROMPT,
  REVIEW_EDUCATIONAL_ARTIFACTS_PROMPT,
  REVISE_EDUCATIONAL_ARTIFACTS_PROMPT,
} from "./educationalization-prompts"

export const RESEARCH_EDUCATIONALIZATION_PROFILE_NAME = "research-educationalization"

export async function resolveResearchEducationalizationProfile(input: Readonly<{
  readonly client: OpencodeClient | undefined
  readonly plugin_agents: AgentOverrides | undefined
  readonly max_review_rounds: number
}>): Promise<WorkflowStateV1["profile_snapshot"]> {
  const roles = {
    solve: { agent: "solver" },
    review: { agent: "reference-reviewer" },
    revise: { agent: "solver" },
  }
  const models = await resolveWorkflowRoleModels({
    client: input.client,
    plugin_agents: input.plugin_agents,
    roles,
  })
  return WorkflowProfileSnapshotSchema.parse({
    snapshot_version: 1,
    name: RESEARCH_EDUCATIONALIZATION_PROFILE_NAME,
    solve: roleSnapshot("solver", models.solve, GENERATE_EDUCATIONAL_ARTIFACTS_PROMPT, "research_educational_artifacts"),
    review: roleSnapshot("reference-reviewer", models.review, REVIEW_EDUCATIONAL_ARTIFACTS_PROMPT, "research_educational_review_json"),
    revise: roleSnapshot("solver", models.revise, REVISE_EDUCATIONAL_ARTIFACTS_PROMPT, "research_educational_artifacts"),
    min_review_rounds: 1,
    max_review_rounds: input.max_review_rounds,
    required_consecutive_passes: 1,
    checkpoint: "none",
  })
}

function roleSnapshot(
  agent: string,
  model: WorkflowStateV1["profile_snapshot"]["solve"]["model"],
  content: string,
  outputAdapter: WorkflowStateV1["profile_snapshot"]["solve"]["output_adapter"],
) {
  return { agent, model, prompt: { kind: "inline" as const, content }, output_adapter: outputAdapter }
}
