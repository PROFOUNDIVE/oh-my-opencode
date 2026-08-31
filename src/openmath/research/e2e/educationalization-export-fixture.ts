import type { WorkflowStateV1 } from "../../workflow/state"
import type { StageRunnerRuntime } from "../../workflow/stage-runner"
import { StagePersistenceError } from "../../workflow/stage-runner/stage-persistence-error"
import { compareAndSwapWorkflowState } from "../../workflow/storage"
import { stepResearchCertification } from "../certification/application/step-research-certification"
import { createPromotionDossierStepDependencies } from "../dossier"
import { createOpenMathResearchTools } from "../../../tools/openmath-research-tools"
import { researchToolConfig, researchToolContext } from "../../../tools/openmath-research-test-support"
import { createCertificationV2StoreFixture } from "./certification-v2-store-fixture"
import {
  GENERATE_EDUCATIONAL_ARTIFACTS_PROMPT,
  REVIEW_EDUCATIONAL_ARTIFACTS_PROMPT,
  REVISE_EDUCATIONAL_ARTIFACTS_PROMPT,
} from "../educationalization/educationalization-prompts"

type EducationalizationFixtureOptions = Readonly<{
  readonly malformed_generation?: boolean
  readonly skip_educationalization?: boolean
}>

export async function createApprovedEducationalizationFixture(options: EducationalizationFixtureOptions = {}) {
  const harness = createCertificationV2StoreFixture()
  const dossier = createPromotionDossierStepDependencies({ directory: harness.directory })
  const control = { dispatches: 0, reviews: ["REVISE", "PASS"] }
  const tools = createOpenMathResearchTools({
    directory: harness.directory,
    openmathConfig: researchToolConfig(),
    resolveEducationalizationProfile: async () => educationalProfile(),
    createEducationalizationRuntime: ({ state }) => educationalRuntime(
      harness.directory,
      state,
      control,
      options,
    ),
    createStepDependencies: () => ({
      plan_operation: () => ({ ok: false, error_code: "ILLEGAL_TRANSITION", message: "unused" }),
      run_operation: async () => ({ ok: false, error_code: "ILLEGAL_TRANSITION", message: "unused" }),
      prepare_dossier: dossier.prepare_dossier,
      step_certification: (input) => stepResearchCertification(input, {
        plan_operation: () => ({ ok: false, error_code: "ILLEGAL_TRANSITION", message: "unused" }),
        run_operation: async () => ({ ok: false, error_code: "ILLEGAL_TRANSITION", message: "unused" }),
      }),
    }),
  })
  const step = tools.openmath_research_step
  const promote = tools.openmath_research_promote
  const educationalize = tools.openmath_research_educationalize
  if (step === undefined || promote === undefined || educationalize === undefined) throw new TypeError("Research tools unavailable")
  const checkpoint = parse(await step.execute({
    campaign_id: harness.fixture.campaign.campaign_id,
    expected_state_revision: harness.fixture.campaign.state_revision,
    expected_certification_revision: harness.fixture.certification.certification_revision,
    mode: "one_stage",
  }, researchToolContext()))
  const promoted = parse(await promote.execute({
    campaign_id: harness.fixture.campaign.campaign_id,
    expected_state_revision: checkpoint.state_revision,
    expected_certification_revision: harness.fixture.certification.certification_revision,
    dossier_sha256: checkpoint.dossier.content_sha256,
    decision: "approve",
  }, researchToolContext()))
  const educationalizationInput = {
    campaign_id: harness.fixture.campaign.campaign_id,
    expected_state_revision: promoted.state_revision,
    expected_certification_revision: harness.fixture.certification.certification_revision,
    dossier_sha256: checkpoint.dossier.content_sha256,
  }
  const educationalized = options.skip_educationalization === true
    ? null
    : parse(await educationalize.execute(educationalizationInput, researchToolContext()))
  return { ...harness, control, checkpoint, promoted, educationalized, educationalize, educationalizationInput }
}

function educationalRuntime(
  directory: string,
  initial: WorkflowStateV1,
  control: { dispatches: number; reviews: string[] },
  options: EducationalizationFixtureOptions,
): StageRunnerRuntime {
  let current = initial
  const messages: Array<{ readonly role: string; readonly text: string }> = []
  return {
    persist: async (next) => {
      const result = await compareAndSwapWorkflowState({ directory, run_id: current.run_id, expected_state_revision: current.state_revision, next_state: next })
      if (result.kind === "error") throw new StagePersistenceError(result.error_code, result.message)
      current = result.state
      return current
    },
    list_children: async () => [],
    get_session: async () => ({ title: "unused" }),
    list_messages: async () => messages,
    dispatch: async (input) => {
      control.dispatches += 1
      const sessionId = `educational-e2e-${control.dispatches}`
      await input.awaited_callbacks.on_session_created?.(sessionId)
      messages.push({ role: "user", text: `${input.prompt_marker}${input.user_prompt}` })
      await input.awaited_callbacks.on_prompt_sent?.(sessionId)
      if (input.agent_to_use === "reference-reviewer") {
        const verdict = control.reviews.shift() ?? "PASS"
        return { ok: true, session_id: sessionId, text: review(verdict) }
      }
      return {
        ok: true,
        session_id: sessionId,
        text: options.malformed_generation === true ? "not json" : artifacts("Theorem\nLemma\nClaim\nDefinition\nImported\nComputation"),
      }
    },
  }
}

function educationalProfile(): WorkflowStateV1["profile_snapshot"] {
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

function artifacts(referenceSolution: string): string {
  return JSON.stringify({
    reference_solution: referenceSolution,
    hint_ladder: { L1_nudge: "Begin with the definition.", L2_key_theorem: "Use the key lemma.", L3_skeleton: ["State assumptions", "Apply the lemma", "Conclude"], L4_full_solution: "@REFERENCE_SOLUTION" },
    grading_rubric: { premises_check: ["All hypotheses stated"], logical_steps: ["Lemma applied correctly"], common_pitfalls: ["No hidden converse"], key_theorem: "Key lemma", key_technique: "Direct proof" },
    variant_problem: "Prove the corresponding finite-family statement.",
  })
}

function review(verdict: string): string {
  return JSON.stringify({
    verdict,
    blocking_issues: verdict === "REVISE" ? ["Reveal the theorem more gradually"] : [],
    checks_performed: ["reference_solution_consistency", "hint_progression", "rubric_fidelity", "variant_validity", "uncertainty_fidelity"],
  })
}

function parse(value: unknown) {
  return JSON.parse(String(value))
}
