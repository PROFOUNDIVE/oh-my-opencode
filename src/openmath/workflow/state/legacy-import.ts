import { createHash } from "node:crypto"
import { z } from "zod"

import { LegacyFrozenArtifactsSchema, LegacyReviewMetadataSchema } from "./contracts"
import { createLegacyImportedArtifact } from "./legacy-artifact-import"
import type { ReferenceSnapshotSchema, WorkflowProfileSnapshotSchema } from "./snapshots"
import { WorkflowStateV1Schema, type WorkflowStateV1 } from "./schema"

const LegacyOpenMathSessionStateSchema = z.object({
  session_id: z.string().min(1),
  original_problem_text: z.string().optional(),
  artifact_state: z.enum(["DRAFT", "FROZEN", "UNFROZEN"]),
  artifact_version: z.number().int().positive(),
  review_round: z.number().int().positive(),
  max_review_rounds: z.number().int().positive(),
  hint_budget_state: z.object({
    hints_used: z.number().int().nonnegative(),
    hint_budget: z.number().int().nonnegative(),
  }).strict(),
  frozen_artifacts: LegacyFrozenArtifactsSchema.nullable(),
}).strict()

type LegacyImportInput = {
  readonly source_bytes: Uint8Array
  readonly parent_session_id: string
  readonly legacy_profile_name: string
  readonly invocation: string
  readonly profile_snapshot: z.infer<typeof WorkflowProfileSnapshotSchema>
  readonly reference_snapshot: z.infer<typeof ReferenceSnapshotSchema>
  readonly existing_state: WorkflowStateV1 | null
}

export type LegacyImportResult =
  | { readonly kind: "imported"; readonly state: WorkflowStateV1 }
  | { readonly kind: "skipped"; readonly message: string }
  | { readonly kind: "error"; readonly error_code: "STORAGE_READ_FAILED"; readonly message: string }

export function importLegacySolveOnlyState(input: LegacyImportInput): LegacyImportResult {
  if (
    input.invocation !== "solve_only"
    || (input.legacy_profile_name !== "legacy-educational-markdown"
      && input.legacy_profile_name !== "legacy-educational-json")
  ) {
    return { kind: "skipped", message: "Legacy import requires a legacy solve-only profile" }
  }
  const sourceHash = hashBytes(input.source_bytes)
  if (input.existing_state?.legacy_source_hash === sourceHash) {
    return { kind: "skipped", message: "Legacy state was already imported" }
  }
  if (input.existing_state?.legacy_source_hash !== null && input.existing_state !== null) {
    return { kind: "error", error_code: "STORAGE_READ_FAILED", message: "Legacy source hash does not match" }
  }

  const decoded = decodeUtf8(input.source_bytes)
  if (decoded === null) return { kind: "error", error_code: "STORAGE_READ_FAILED", message: "Legacy state is not UTF-8" }
  const legacy = LegacyOpenMathSessionStateSchema.safeParse(parseJson(decoded))
  if (!legacy.success) return { kind: "error", error_code: "STORAGE_READ_FAILED", message: "Legacy state is invalid" }

  const importedArtifact = createLegacyImportedArtifact({
    frozen_artifacts: legacy.data.frozen_artifacts,
    artifact_version: legacy.data.artifact_version,
    profile_name: input.legacy_profile_name,
  })
  if (!importedArtifact.ok) {
    return { kind: "error", error_code: "STORAGE_READ_FAILED", message: importedArtifact.message }
  }
  const artifact = importedArtifact.artifact
  const latestReview = createLatestReview(legacy.data, artifact)
  const state = WorkflowStateV1Schema.safeParse({
    schema_version: 1,
    run_id: legacy.data.session_id,
    state_revision: 0,
    parent_session_id: input.parent_session_id,
    status: importedStatus(legacy.data.artifact_state),
    next_stage: importedNextStage(legacy.data.artifact_state, artifact, latestReview),
    awaiting_reason: null,
    abort_requested: false,
    abort_reason: null,
    blocked_reason: null,
    intervention_satisfied: false,
    review_round: legacy.data.review_round,
    completed_review_rounds: latestReview?.round ?? 0,
    consecutive_passes: latestReview?.verdict === "PASS" ? 1 : 0,
    artifact_version: legacy.data.artifact_version,
    profile_snapshot: input.profile_snapshot,
    reference_snapshot: input.reference_snapshot,
    artifact,
    latest_review: latestReview,
    review_history: latestReview === null ? [] : [latestReview],
    amendments: [],
    stage_history: [],
    dispatch_attempts: [],
    legacy_projection: {
      kind: "solve_only",
      schema_version: 1,
      session_id: legacy.data.session_id,
      original_problem_text: legacy.data.original_problem_text ?? null,
      artifact_state: legacy.data.artifact_state,
      max_review_rounds: legacy.data.max_review_rounds,
      hint_budget_state: legacy.data.hint_budget_state,
      review_metadata: legacyReviewMetadata(legacy.data.frozen_artifacts),
      markdown_fallback: null,
    },
    legacy_source_hash: sourceHash,
  })
  if (!state.success) {
    return { kind: "error", error_code: "STORAGE_READ_FAILED", message: "Imported legacy state is invalid" }
  }
  return { kind: "imported", state: state.data }
}

function legacyReviewMetadata(frozen: z.infer<typeof LegacyFrozenArtifactsSchema> | null) {
  if (frozen === null) return null
  const retained = frozen.hint_ladder["__orchestrator_state"]
  const blockingIssues = retained !== null && typeof retained === "object" && !Array.isArray(retained)
    && Array.isArray(retained["last_blocking_issues"])
    ? retained["last_blocking_issues"]
    : undefined
  return LegacyReviewMetadataSchema.parse({
    certificate: {
      artifact_version: frozen.review_certificate.artifact_version,
      review_round: frozen.review_certificate.review_round,
      timestamp: frozen.review_certificate.timestamp,
      ...(frozen.review_certificate.notes === undefined ? {} : { notes: frozen.review_certificate.notes }),
    },
    ...(blockingIssues === undefined ? {} : { blocking_issues: blockingIssues }),
  })
}

function parseJson(content: string): unknown {
  try {
    return JSON.parse(content)
  } catch {
    return null
  }
}

function decodeUtf8(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

function hashBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}

function hashText(content: string): string {
  return hashBytes(Buffer.from(content, "utf8"))
}

function importedStatus(artifactState: "DRAFT" | "FROZEN" | "UNFROZEN") {
  switch (artifactState) {
    case "DRAFT":
      return "READY" as const
    case "FROZEN":
      return "PASSED" as const
    case "UNFROZEN":
      return "EXHAUSTED" as const
  }
}

function importedNextStage(
  artifactState: "DRAFT" | "FROZEN" | "UNFROZEN",
  artifact: { readonly sha256: string } | null,
  latestReview: ReturnType<typeof createLatestReview>,
) {
  if (artifactState !== "DRAFT") return null
  if (artifact === null) return "SOLVE" as const
  return latestReview?.verdict === "REVISE" ? "REVISE" as const : "REVIEW" as const
}

function createLatestReview(
  legacy: z.infer<typeof LegacyOpenMathSessionStateSchema>,
  artifact: { readonly sha256: string } | null,
) {
  if (legacy.frozen_artifacts === null) return null
  const certificate = legacy.frozen_artifacts.review_certificate
  const rawReport = certificate.notes ?? ""
  return {
    round: certificate.review_round,
    verdict: certificate.verdict === "[CORRECT]" ? "PASS" as const : certificate.verdict === "[ERROR]" ? "REVISE" as const : "INCONCLUSIVE" as const,
    raw_report: rawReport,
    raw_report_sha256: hashText(rawReport),
    findings: [],
    checks_performed: [],
    session_id: legacy.session_id,
    prompt_hash: hashText(legacy.session_id),
    reference_hash: hashText(legacy.session_id),
    artifact_input_hash: artifact?.sha256 ?? hashText(""),
  }
}
