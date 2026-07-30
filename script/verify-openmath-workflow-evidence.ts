import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { isAbsolute, join, normalize } from "node:path"
import { z } from "zod"

export const OPENMATH_WORKFLOW_BASE = "e3dba8329718052e672ebddea9b89caa3e207582"
const TASK_IDS = Array.from({ length: 15 }, (_, index) => `task-${index + 1}`)
export const REQUIRED_OPENMATH_WORKFLOW_SUCCESS_CRITERIA = [
  { id: "success-1", criterion: "External replacement prompt files work without TypeScript edits; legacy inline and append behavior remains compatible." },
  { id: "success-2", criterion: "A named profile deterministically selects agents, models, prompt snapshots, adapters, stop policy, and checkpoint policy." },
  { id: "success-3", criterion: "Solver, reviewer, and reviser receive their declared immutable reference snapshot; explicit reload alone changes snapshot version/hash." },
  { id: "success-4", criterion: "Generic markdown and legacy educational artifacts both complete SOLVE→REVIEW→REVISE through built-in adapters." },
  { id: "success-5", criterion: "Every stage and amendment is persisted with concrete versioned types, hashes, revisions, history, and session receipts." },
  { id: "success-6", criterion: "Workflow tools pause/resume at deterministic checkpoints, reject stale revisions, return `next_actions`, and never require raw-state mutation." },
  { id: "success-7", criterion: "Minimum review rounds, maximum rounds, and consecutive PASS rules match the fixed contracts in this plan." },
  { id: "success-8", criterion: "Restart/crash fixtures reconcile recorded attempts without duplicate commit and block safely when identity is ambiguous." },
  { id: "success-9", criterion: "Existing solve-only inputs/results, state tools/files, educational patches, exports, config defaults, Windows/Linux compatibility, and independent-run concurrency pass regression tests." },
  { id: "success-10", criterion: "F1-F4 approve in parallel and F5 closes their receipts; full tests, typecheck, and build exit 0; no forbidden code-quality or scope violations remain." },
] as const

const RequirementSchema = z.object({
  id: z.string().min(1),
  criterion: z.string().min(1).optional(),
  test_files: z.array(z.string().min(1)).min(1),
  evidence_artifacts: z.array(z.string().min(1)).min(1),
}).strict()
const ManifestSchema = z.object({
  immutable_base: z.literal(OPENMATH_WORKFLOW_BASE),
  requirements: z.array(RequirementSchema),
}).strict()

export type OpenMathWorkflowEvidenceInput = Readonly<{
  readonly manifestPath: string
  readonly evidenceDirectory: string
  readonly projectDirectory: string
  readonly finalReceipts?: readonly string[]
  readonly planPath?: string
}>

export class OpenMathWorkflowEvidenceError extends Error {
  readonly name = "OpenMathWorkflowEvidenceError"
}

export function verifyOpenMathWorkflowEvidence(input: OpenMathWorkflowEvidenceInput): void {
  const manifest = ManifestSchema.parse(JSON.parse(readFileSync(input.manifestPath, "utf8")))
  const byId = new Map(manifest.requirements.map((requirement) => [requirement.id, requirement]))
  const expectedIds = new Set([...TASK_IDS, ...REQUIRED_OPENMATH_WORKFLOW_SUCCESS_CRITERIA.map(({ id }) => id)])
  if (byId.size !== manifest.requirements.length || byId.size !== expectedIds.size) throw new OpenMathWorkflowEvidenceError("Requirements must contain task-1 through task-15 and success-1 through success-10 exactly once")
  for (const id of expectedIds) if (!byId.has(id)) throw new OpenMathWorkflowEvidenceError(`Missing required receipt: ${id}`)
  for (const requirement of manifest.requirements) verifyRequirement(requirement, input)
  for (const expected of REQUIRED_OPENMATH_WORKFLOW_SUCCESS_CRITERIA) {
    if (byId.get(expected.id)?.criterion !== expected.criterion) throw new OpenMathWorkflowEvidenceError(`Success criterion does not match the plan: ${expected.id}`)
  }
  if (input.finalReceipts) verifyFinalReceipts(input.finalReceipts, input)
}

function verifyRequirement(requirement: z.infer<typeof RequirementSchema>, input: OpenMathWorkflowEvidenceInput): void {
  for (const path of requirement.test_files) verifyFile(path, input.projectDirectory, `Test file is missing: ${path}`)
  for (const path of requirement.evidence_artifacts) {
    if (/^F[1-5](?:[.-]|$)/.test(path)) throw new OpenMathWorkflowEvidenceError(`Final-wave receipt must not be in the manifest: ${path}`)
    verifyFile(path, input.evidenceDirectory, `Evidence artifact is missing: ${path}`)
  }
}

function verifyFile(path: string, directory: string, message: string): void {
  if (isAbsolute(path) || normalize(path).startsWith("..")) throw new OpenMathWorkflowEvidenceError(`Path escapes its root: ${path}`)
  if (!existsSync(join(directory, path))) throw new OpenMathWorkflowEvidenceError(message)
}

function verifyFinalReceipts(receipts: readonly string[], input: OpenMathWorkflowEvidenceInput): void {
  const planHash = createHash("sha256").update(readFileSync(input.planPath ?? ".omo/plans/openmath_configurable_and_interruptible_review-loop_refactor.md")).digest("hex")
  for (const receipt of receipts) {
    const exitPath = join(input.evidenceDirectory, `${receipt}.exit`)
    const receiptPath = join(input.evidenceDirectory, `${receipt}.receipt.json`)
    if (readFileSync(exitPath, "utf8").trim() !== "0") throw new OpenMathWorkflowEvidenceError(`Final-wave exit is not zero: ${receipt}`)
    const parsed = z.object({ verifier: z.literal(receipt), plan_sha: z.literal(planHash) }).strict().safeParse(JSON.parse(readFileSync(receiptPath, "utf8")))
    if (!parsed.success) throw new OpenMathWorkflowEvidenceError(`Final-wave receipt is invalid: ${receipt}`)
  }
}

function parseCliArgs(args: readonly string[]): OpenMathWorkflowEvidenceInput | undefined {
  const values = new Map<string, string>()
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]
    const value = args[index + 1]
    if (!key || !value || !key.startsWith("--")) return undefined
    values.set(key, value)
  }
  const manifestPath = values.get("--manifest")
  const evidenceDirectory = values.get("--evidence-dir")
  if (!manifestPath || !evidenceDirectory) return undefined
  const receipts = values.get("--final-receipts")
  return { manifestPath, evidenceDirectory, projectDirectory: process.cwd(), finalReceipts: receipts?.split(",").filter(Boolean) }
}

if (import.meta.main) {
  const input = parseCliArgs(Bun.argv.slice(2))
  if (!input) throw new OpenMathWorkflowEvidenceError("Usage: bun run script/verify-openmath-workflow-evidence.ts --manifest <path> --evidence-dir <path> [--final-receipts F1,F2,F3,F4]")
  verifyOpenMathWorkflowEvidence(input)
  console.log("OpenMath workflow evidence verification passed.")
}
