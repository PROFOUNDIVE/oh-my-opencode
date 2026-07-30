import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { OpenMathConfigSchema } from "../../config/schema"
import { createOpenMathWorkflowAmendTool } from "../../tools/openmath-workflow-amend"
import { createOpenMathWorkflowReloadTool } from "../../tools/openmath-workflow-reload"
import { createOpenMathWorkflowStartTool } from "../../tools/openmath-workflow-start"
import { createOpenMathWorkflowStatusTool } from "../../tools/openmath-workflow-status"
import { createOpenMathWorkflowStepTool } from "../../tools/openmath-workflow-step"
import { WorkflowErrorEnvelopeSchema, WorkflowSuccessEnvelopeSchema, type WorkflowErrorEnvelope, type WorkflowSuccessEnvelope } from "../../tools/openmath-workflow-shared"
import { resolveWorkflowProfilePromptSources } from "./profile-prompt-sources"
import { createE2ERuntime, type E2ERuntimeControl } from "./e2e-runtime"
import { readWorkflowState } from "./storage"
import type { WorkflowStateV1 } from "./state"

const context = { sessionID: "e2e-parent", messageID: "e2e-message", agent: "test", abort: new AbortController().signal }

type SuccessResult = {
  readonly started: WorkflowSuccessEnvelope
  readonly reviewOne: WorkflowSuccessEnvelope
  readonly amended: WorkflowSuccessEnvelope
  readonly reviewTwo: WorkflowSuccessEnvelope
  readonly reloaded: { readonly state_revision: number; readonly reference_version: number; readonly reference_hash: string; readonly prompt_hash: string }
  readonly restarted: WorkflowSuccessEnvelope
  readonly final: WorkflowSuccessEnvelope
  readonly initial_reference_version: number
  readonly initial_reference_hash: string
  readonly initial_prompt_hash: string
  readonly final_state: WorkflowStateV1
}

export function createWorkflowE2EHarness(verdicts: readonly string[]) {
  const directory = mkdtempSync(join(tmpdir(), "openmath-e2e-"))
  const outside = mkdtempSync(join(tmpdir(), "openmath-e2e-outside-"))
  const control: E2ERuntimeControl = { mode: "normal", crashed: false, verdicts: [...verdicts], childCount: 0, knownTitle: "", children: [], messages: [] }
  const paths = seedFiles(directory, outside)
  const config = configuredProfile(directory)
  const tools = () => createTools(directory, config, control)
  return {
    cleanup: () => { rmSync(directory, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }) },
    runSuccessWorkflow: async (): Promise<SuccessResult> => {
      const active = tools()
      const started = success(await active.start.execute({ run_id: "success", request: { kind: "markdown", instruction: "Prove it." }, reference_manifest_path: paths.manifest }, context))
      const initial = await state(directory, "success")
      const initialPromptHash = promptHash(initial)
      const reviewOne = success(await active.step.execute({ run_id: "success", expected_state_revision: started.state_revision, mode: "to_checkpoint" }, context))
      const amended = success(await active.amend.execute({ run_id: "success", expected_state_revision: reviewOne.state_revision, operation: "add", kind: "required_check", scope: "next_review", content: "Check the base case." }, context))
      const reviewTwo = success(await active.step.execute({ run_id: "success", expected_state_revision: amended.state_revision, mode: "to_checkpoint" }, context))
      writeFileSync(paths.reference, "reference-v2", "utf8")
      const reloadedEnvelope = success(await active.reload.execute({ run_id: "success", expected_state_revision: reviewTwo.state_revision, targets: ["references"] }, context))
      const reloadedState = await state(directory, "success")
      const reloaded = { state_revision: reloadedEnvelope.state_revision, reference_version: reloadedState.reference_snapshot.version, reference_hash: reloadedState.reference_snapshot.sha256, prompt_hash: promptHash(reloadedState) }
      await active.step.execute({ run_id: "success", expected_state_revision: reloaded.state_revision, mode: "to_checkpoint" }, context)
      const restarted = success(await tools().status.execute({ run_id: "success" }, context))
      const reviewFour = success(await tools().step.execute({ run_id: "success", expected_state_revision: restarted.state_revision, mode: "to_checkpoint" }, context))
      const final = success(await tools().step.execute({ run_id: "success", expected_state_revision: reviewFour.state_revision, mode: "to_checkpoint" }, context))
      return { started, reviewOne, amended, reviewTwo, reloaded, restarted, final, initial_reference_version: initial.reference_snapshot.version, initial_reference_hash: initial.reference_snapshot.sha256, initial_prompt_hash: initialPromptHash, final_state: await state(directory, "success") }
    },
    runFailureWorkflow: async () => {
      const active = tools()
      const started = success(await active.start.execute({ run_id: "malformed", request: { kind: "markdown", instruction: "Prove it." } }, context))
      const malformed = success(await active.step.execute({ run_id: "malformed", expected_state_revision: started.state_revision, mode: "to_checkpoint" }, context))
      const malformedState = await state(directory, "malformed")
      const staleStart = success(await active.start.execute({ run_id: "stale", request: { kind: "markdown", instruction: "Prove it." } }, context))
      const stale = error(await active.step.execute({ run_id: "stale", expected_state_revision: staleStart.state_revision + 1 }, context))
      const rejectedPath = error(await active.start.execute({ run_id: "rejected", request: { kind: "markdown", instruction: "Prove it." }, reference_manifest_path: paths.outsideManifest }, context))
      return { malformed, malformed_record: malformedState.stage_history.at(-1), stale, rejected_path: rejectedPath }
    },
    runCrashWorkflow: async () => {
      const active = tools()
      const ambiguousStart = success(await active.start.execute({ run_id: "ambiguous", request: { kind: "markdown", instruction: "Prove it." } }, context))
      control.mode = "crash_prepared"
      await active.step.execute({ run_id: "ambiguous", expected_state_revision: ambiguousStart.state_revision }, context)
      control.mode = "ambiguous"
      const blocked = success(await tools().step.execute({ run_id: "ambiguous", expected_state_revision: (await state(directory, "ambiguous")).state_revision }, context))
      const blockedState = await state(directory, "ambiguous")
      control.mode = "normal"
      control.crashed = false
      const resumeStart = success(await tools().start.execute({ run_id: "resumed", request: { kind: "markdown", instruction: "Prove it." } }, context))
      control.mode = "crash_completed"
      await tools().step.execute({ run_id: "resumed", expected_state_revision: resumeStart.state_revision }, context)
      control.mode = "normal"
      const resumed = success(await tools().step.execute({ run_id: "resumed", expected_state_revision: (await state(directory, "resumed")).state_revision }, context))
      const resumedState = await state(directory, "resumed")
      return { blocked, blocked_record: blockedState.stage_history.at(-1), resumed, resumed_attempts: resumedState.dispatch_attempts, resumed_records: resumedState.stage_history }
    },
  }
}

export function writeWorkflowE2EEvidence(result: SuccessResult): void {
  const path = process.env.OPENMATH_E2E_EVIDENCE
  if (!path) return
  writeFileSync(path, JSON.stringify({ run_id: result.final.run_id, revisions: { start: result.started.state_revision, review_one: result.reviewOne.state_revision, review_two: result.reviewTwo.state_revision, reload: result.reloaded.state_revision, restart: result.restarted.state_revision, final: result.final.state_revision }, snapshots: { initial_reference_version: result.initial_reference_version, reloaded_reference_version: result.reloaded.reference_version, initial_reference_hash: result.initial_reference_hash, reloaded_reference_hash: result.reloaded.reference_hash, prompt_hash: result.reloaded.prompt_hash }, final: { status: result.final.status, completed_review_rounds: result.final_state.completed_review_rounds, consecutive_passes: result.final_state.consecutive_passes, artifact_hash: result.final_state.artifact?.sha256, stage_receipts: result.final_state.stage_history.map((record) => ({ stage: record.stage, outcome: record.outcome, output_hash: record.output_hash })) } }, null, 2), "utf8")
}

function seedFiles(directory: string, outside: string) {
  const reference = join(directory, "reference.md")
  const manifest = join(directory, "references.json")
  const outsideManifest = join(outside, "references.json")
  for (const name of ["solve.md", "review.md", "revise.md"]) writeFileSync(join(directory, name), name, "utf8")
  writeFileSync(reference, "reference-v1", "utf8")
  writeFileSync(manifest, JSON.stringify({ version: 1, references: [{ id: "reference", path: "reference.md", role: "authoritative", stages: ["solve", "review", "revise"] }] }), "utf8")
  writeFileSync(outsideManifest, JSON.stringify({ version: 1, references: [] }), "utf8")
  return { reference, manifest, outsideManifest }
}

function configuredProfile(directory: string) {
  const config = OpenMathConfigSchema.parse({ default_workflow_profile: "e2e", workflow_allowed_roots: [directory], workflow_profiles: { e2e: { solve: role("solver", "solve.md", "opaque_markdown"), review: role("reviewer", "review.md", "review_verdict_markdown"), revise: role("reviser", "revise.md", "full_replace_markdown"), min_review_rounds: 5, max_review_rounds: 7, required_consecutive_passes: 2, checkpoint: "after_review" } } })
  return { ...config, workflow_profiles: resolveWorkflowProfilePromptSources(config.workflow_profiles, directory) }
}

function role(agent: string, file: string, outputAdapter: "opaque_markdown" | "review_verdict_markdown" | "full_replace_markdown") { return { agent, model: `openai/${agent}`, prompt: { kind: "file" as const, uri: `file://./${file}` }, output_adapter: outputAdapter } }
function createTools(directory: string, openmathConfig: ReturnType<typeof configuredProfile>, control: E2ERuntimeControl) { const options = { directory, openmathConfig, createStageRuntime: ({ state }: { readonly state: WorkflowStateV1 }) => createE2ERuntime(directory, state, control) }; return { start: createOpenMathWorkflowStartTool(options), step: createOpenMathWorkflowStepTool(options), amend: createOpenMathWorkflowAmendTool(options), reload: createOpenMathWorkflowReloadTool(options), status: createOpenMathWorkflowStatusTool(options) } }
async function state(directory: string, runID: string): Promise<WorkflowStateV1> { const result = await readWorkflowState(directory, runID); if (result.kind === "error") throw new Error(result.message); return result.state }
function success(value: unknown): WorkflowSuccessEnvelope { return WorkflowSuccessEnvelopeSchema.parse(JSON.parse(String(value))) }
function error(value: unknown): WorkflowErrorEnvelope { return WorkflowErrorEnvelopeSchema.parse(JSON.parse(String(value))) }
function promptHash(state: WorkflowStateV1): string { const prompt = state.profile_snapshot.solve.prompt; if (prompt.kind !== "file") throw new Error("Expected file prompt"); return prompt.content_hash }
