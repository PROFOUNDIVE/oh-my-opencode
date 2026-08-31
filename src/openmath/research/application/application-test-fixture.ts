import { createHash } from "node:crypto"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { ReferenceSnapshot } from "../../references/types"
import type { WorkflowRequestSnapshot } from "../../workflow/state"
import type { ResearchProfileSnapshot } from "../profile-snapshot"
import { ReferenceSnapshotSchema, WorkflowProfileSnapshotSchema } from "../../workflow/state"

export const HASH = "a".repeat(64)

export function temporaryCampaignDirectory(): string {
  return mkdtempSync(join(tmpdir(), "openmath-research-application-"))
}

export function removeTemporaryCampaignDirectory(directory: string): void {
  rmSync(directory, { recursive: true, force: true })
}

export function objectiveSnapshot(): WorkflowRequestSnapshot {
  return { kind: "markdown", instruction: "Prove the conjecture." }
}

export function referenceSnapshot(): ReferenceSnapshot {
  return ReferenceSnapshotSchema.parse({
    version: 1,
    manifest: { kind: "legacy_supplementary" },
    references: [],
    diagnostics: [],
    sha256: HASH,
  })
}

export function profileSnapshot(references: ReferenceSnapshot = referenceSnapshot()): ResearchProfileSnapshot {
  const workflowProfile = WorkflowProfileSnapshotSchema.parse({
    snapshot_version: 1,
    name: "candidate-profile",
    solve: role("opaque_markdown"),
    review: role("review_verdict_json"),
    revise: role("patch_set_json"),
    min_review_rounds: 1,
    max_review_rounds: 2,
    required_consecutive_passes: 1,
    checkpoint: "after_solve",
  })
  const core = {
    snapshot_version: 1 as const,
    name: "phase-a-profile",
    candidate_workflow_profile: workflowProfile,
    candidate_workflow_profile_hash: hash(JSON.stringify(workflowProfile)),
    strategies: [
      { id: "direct", prompt: { kind: "inline" as const, content: "Use a direct argument.", content_hash: HASH } },
      { id: "contradiction", prompt: { kind: "inline" as const, content: "Use contradiction.", content_hash: HASH } },
    ],
    candidates_per_strategy: 1,
    screening_roles: [{ id: "screen", ...researchRole("screen-agent") }],
    max_active_candidates: 2,
    survivor_limit: 1,
    tournament_role: researchRole("tournament-agent"),
  }
  return Object.freeze({ ...core, profile_hash: hash(JSON.stringify(core)), reference_snapshot: references })
}

export function rehashProfileSnapshot(profile: ResearchProfileSnapshot): ResearchProfileSnapshot {
  const { profile_hash: _profileHash, reference_snapshot: references, ...staleCore } = profile
  const core = {
    ...staleCore,
    candidate_workflow_profile_hash: hash(JSON.stringify(profile.candidate_workflow_profile)),
  }
  return Object.freeze({ ...core, profile_hash: hash(JSON.stringify(core)), reference_snapshot: references })
}

function role(output_adapter: "opaque_markdown" | "review_verdict_json" | "patch_set_json") {
  return {
    agent: "solver",
    model: { providerID: "openai", modelID: "gpt-5" },
    prompt: { kind: "builtin" as const },
    output_adapter,
  }
}

function researchRole(agent: string) {
  return {
    agent,
    model: { providerID: "openai", modelID: "gpt-5" },
    prompt: { kind: "inline" as const, content: `${agent} prompt`, content_hash: HASH },
  }
}

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex")
}
