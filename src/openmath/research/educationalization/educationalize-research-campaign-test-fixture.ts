import type { WorkflowStateV1 } from "../../workflow/state"
import type { StageRunnerRuntime } from "../../workflow/stage-runner"
import { sha256 } from "../../workflow/stage-runner/sha256"
import { compareAndSwapWorkflowState } from "../../workflow/storage"
import type { ApprovedEducationalSource } from "./approved-source"
import {
  GENERATE_EDUCATIONAL_ARTIFACTS_PROMPT,
  REVIEW_EDUCATIONAL_ARTIFACTS_PROMPT,
  REVISE_EDUCATIONAL_ARTIFACTS_PROMPT,
} from "./educationalization-prompts"

const HASH_A = "a".repeat(64)
const HASH_C = "c".repeat(64)

export type EducationalizationTestControl = {
  dispatches: number
  reviews: string[]
  mutateRevision?: boolean
  crashAfterPrepared?: boolean
  policies?: Array<string | undefined>
}

export function dependenciesFor(directory: string, source: ApprovedEducationalSource, control: EducationalizationTestControl) {
  return {
    validate_source: async () => ({ ok: true as const, source }),
    resolve_profile: async () => profileSnapshot(),
    create_runtime: (state: WorkflowStateV1) => fakeRuntime(directory, state, source, control),
  }
}

export function fakeRuntime(
  directory: string,
  initial: WorkflowStateV1,
  source: ApprovedEducationalSource,
  control: EducationalizationTestControl,
): StageRunnerRuntime {
  let current = initial
  const messages: Array<{ readonly role: string; readonly text: string }> = []
  return {
    persist: async (next) => {
      const result = await compareAndSwapWorkflowState({
        directory,
        run_id: current.run_id,
        expected_state_revision: current.state_revision,
        next_state: next,
      })
      if (result.kind === "error") throw new TypeError(result.message)
      current = result.state
      if (control.crashAfterPrepared === true && current.dispatch_attempts.at(-1)?.phase === "PREPARED") {
        throw new TypeError("planned educationalization crash")
      }
      return current
    },
    list_children: async () => [],
    get_session: async () => ({ title: "unused" }),
    list_messages: async () => messages,
    dispatch: async (input) => {
      control.dispatches += 1
      control.policies?.push(input.tool_policy)
      const sessionId = `educational-child-${control.dispatches}`
      await input.awaited_callbacks.on_session_created?.(sessionId)
      messages.push({ role: "user", text: `${input.prompt_marker}${input.user_prompt}` })
      await input.awaited_callbacks.on_prompt_sent?.(sessionId)
      if (input.agent_to_use === "reference-reviewer") {
        const verdict = control.reviews.shift() ?? "PASS"
        return {
          ok: true,
          session_id: sessionId,
          text: JSON.stringify({
            verdict,
            blocking_issues: verdict === "REVISE" ? ["Improve hint progression"] : verdict === "SOURCE_DEFECT" ? ["Invalid immutable proof"] : [],
            checks_performed: ["reference_solution_consistency", "hint_progression", "rubric_fidelity", "variant_validity", "uncertainty_fidelity"],
          }),
        }
      }
      const isRevision = input.system_content === REVISE_EDUCATIONAL_ARTIFACTS_PROMPT
      return {
        ok: true,
        session_id: sessionId,
        text: artifacts(isRevision && control.mutateRevision === true ? "Mutated proof." : source.reference_solution),
      }
    },
  }
}

export function profileSnapshot(): WorkflowStateV1["profile_snapshot"] {
  const model = { providerID: "openai", modelID: "gpt-5" }
  return {
    snapshot_version: 1,
    name: "research-educationalization",
    solve: { agent: "solver", model, prompt: { kind: "inline", content: GENERATE_EDUCATIONAL_ARTIFACTS_PROMPT }, output_adapter: "research_educational_artifacts" },
    review: { agent: "reference-reviewer", model, prompt: { kind: "inline", content: REVIEW_EDUCATIONAL_ARTIFACTS_PROMPT }, output_adapter: "research_educational_review_json" },
    revise: { agent: "solver", model, prompt: { kind: "inline", content: REVISE_EDUCATIONAL_ARTIFACTS_PROMPT }, output_adapter: "research_educational_artifacts" },
    min_review_rounds: 1,
    max_review_rounds: 3,
    required_consecutive_passes: 1,
    checkpoint: "none",
  }
}

export function approvedSource(): ApprovedEducationalSource {
  const referenceSolution = "Exact approved proof."
  const certificationSummaryJson = '{"approval_eligible":true,"uncertainty_count":0}'
  const remainingUncertaintiesJson = '{"blocking_issues":[],"unresolved_obligations":[],"assumptions":[]}'
  const referenceSolutionSha256 = sha256(referenceSolution)
  return {
    campaign_id: "campaign-a",
    approved_campaign_revision: 13,
    dossier_id: "dossier-campaign-a",
    dossier_sha256: HASH_A,
    selected_artifact: {
      candidate_id: "candidate-01",
      child_run_id: "campaign-a::candidate-01",
      child_state_revision: 7,
      artifact_version: 2,
      media_type: "text/markdown",
      artifact_sha256: referenceSolutionSha256,
    },
    certification: {
      certification_id: "certification-a",
      generation_id: HASH_C,
      certification_revision: 9,
      content_sha256: HASH_A,
      summary_sha256: sha256(certificationSummaryJson),
    },
    certification_summary_json: certificationSummaryJson,
    remaining_uncertainties_json: remainingUncertaintiesJson,
    remaining_uncertainties_sha256: sha256(remainingUncertaintiesJson),
    reference_solution: referenceSolution,
    reference_solution_sha256: referenceSolutionSha256,
    original_problem_text: "Prove the theorem.",
  }
}

export function educationalizationRequest(directory: string) {
  return {
    directory,
    campaign_id: "campaign-a",
    expected_state_revision: 13,
    expected_certification_revision: 9,
    dossier_sha256: HASH_A,
    parent_session_id: "ses_parent1",
  }
}

function artifacts(referenceSolution: string): string {
  return JSON.stringify({
    reference_solution: referenceSolution,
    hint_ladder: {
      L1_nudge: "Nudge",
      L2_key_theorem: "Theorem",
      L3_skeleton: ["First", "Second"],
      L4_full_solution: "@REFERENCE_SOLUTION",
    },
    grading_rubric: {
      premises_check: ["Premises"],
      logical_steps: ["Logic"],
      common_pitfalls: ["Pitfall"],
      key_theorem: "Theorem",
      key_technique: "Technique",
    },
    variant_problem: "A concept-preserving variant.",
  })
}
