import { describe, expect, test } from "bun:test"

import { OpenMathConfigSchema } from "../../../config/schema"
import { createLegacyReferenceSnapshot } from "../../references/snapshot"
import { sha256 } from "../../workflow/stage-runner/sha256"
import { buildCampaignSourceSnapshot } from "../application/build-campaign-source-snapshot"
import { createInitialCampaignState } from "../application/create-initial-campaign-state"
import { objectiveSnapshot, profileSnapshot, referenceSnapshot } from "../application/application-test-fixture"
import { resolveResearchProfileSnapshot } from "../profile-snapshot"
import { CampaignHashSchema } from "../state"
import { parseFrozenCandidateSources } from "./frozen-candidate-sources"

const role = (agent: string) => ({ agent, prompt: { kind: "inline", content: `${agent}-prompt` } })

describe("frozen certification candidate sources", () => {
  test("parses enabled sources through every unchanged Phase-A phase", () => {
    const state = enabledState()

    const results = [
      parseFrozenCandidateSources(state),
      parseFrozenCandidateSources({ ...state, phase: "SCREENING" }),
      parseFrozenCandidateSources({ ...state, phase: "TOURNAMENT" }),
      parseFrozenCandidateSources({ ...state, phase: "DEEP_REFINEMENT" }),
    ]

    expect(results.every((result) => result.ok)).toBe(true)
  })

  test("rejects an outer serialized profile hash mismatch", () => {
    const state = enabledState()

    const result = parseFrozenCandidateSources({
      ...state,
      source_snapshot: {
        ...state.source_snapshot,
        profile: { ...state.source_snapshot.profile, sha256: CampaignHashSchema.parse("b".repeat(64)) },
      },
    })

    expect(result).toEqual({ ok: false, message: "Frozen candidate source hash does not match its serialized bytes" })
  })

  test("rejects an inner profile hash mismatch after the outer hash is rebound", () => {
    const state = enabledState()
    const bytes = state.source_snapshot.profile.serialized_bytes.replace(
      /"profile_hash":"[a-f0-9]{64}"/,
      `"profile_hash":"${"b".repeat(64)}"`,
    )

    const result = parseFrozenCandidateSources(withProfileBytes(state, bytes))

    expect(result).toEqual({ ok: false, message: "Frozen candidate profile hash does not match its contents" })
  })

  test("rejects a stale inner profile hash from a legacy snapshot", () => {
    const state = legacyState()
    const bytes = state.source_snapshot.profile.serialized_bytes.replace(
      /"profile_hash":"[a-f0-9]{64}"/,
      `"profile_hash":"${"b".repeat(64)}"`,
    )

    const result = parseFrozenCandidateSources(withProfileBytes(state, bytes))

    expect(result).toEqual({ ok: false, message: "Frozen candidate profile hash does not match its contents" })
  })

  test("rejects a certification profile hash mismatch after outer and profile hashes are rebound", () => {
    const state = enabledState()
    const certificationMismatch = state.source_snapshot.profile.serialized_bytes.replace(
      /"certification_profile_hash":"[a-f0-9]{64}"/,
      `"certification_profile_hash":"${"b".repeat(64)}"`,
    )
    const core = certificationMismatch.slice(0, certificationMismatch.indexOf(',"profile_hash"')) + "}"
    const bytes = certificationMismatch.replace(
      /"profile_hash":"[a-f0-9]{64}"/,
      `"profile_hash":"${sha256(core)}"`,
    )

    const result = parseFrozenCandidateSources(withProfileBytes(state, bytes))

    expect(result).toEqual({ ok: false, message: "Frozen certification profile hash does not match its contents" })
  })

  test.each([
    [
      /"allowed_attack_modes":\["EDGE_CASE","FINITE_SEARCH"\]/,
      '"allowed_attack_modes":["EDGE_CASE","EDGE_CASE"]',
    ],
    [/"max_attacks_per_obligation":2/, '"max_attacks_per_obligation":3'],
  ])("rejects untrusted frozen mode uniqueness and total-cap violations", (pattern: RegExp, replacement: string) => {
    const state = enabledState()
    const bytes = rebindInnerHashes(state.source_snapshot.profile.serialized_bytes.replace(pattern, replacement))

    const result = parseFrozenCandidateSources(withProfileBytes(state, bytes))

    expect(result).toEqual({ ok: false, message: "Frozen candidate sources are invalid" })
  })
})

function enabledState() {
  const workflow = {
    solve: { agent: "solver", prompt: { kind: "inline", content: "solve" }, output_adapter: "opaque_markdown" },
    review: { agent: "reviewer", prompt: { kind: "inline", content: "review" }, output_adapter: "review_verdict_markdown" },
    revise: { agent: "reviser", prompt: { kind: "inline", content: "revise" }, output_adapter: "full_replace_markdown" },
    min_review_rounds: 1,
    max_review_rounds: 2,
    required_consecutive_passes: 1,
    checkpoint: "after_solve",
  }
  const config = OpenMathConfigSchema.parse({
    workflow_profiles: { candidate: workflow },
    research_profiles: { certified: {
      candidate_workflow_profile: "candidate",
      strategies: [
        { id: "direct", prompt: { kind: "inline", content: "direct" } },
        { id: "contradiction", prompt: { kind: "inline", content: "contradiction" } },
      ],
      candidates_per_strategy: 1,
      screening_roles: [{ id: "screen", ...role("screen-reviewer") }],
      max_active_candidates: 2,
      survivor_limit: 1,
      tournament_role: role("tournament-reviewer"),
      certification: {
        schema_version: 1,
        extraction_role: role("extractor"),
        coverage_role: role("coverage-reviewer"),
        counterexample_role: role("attacker"),
        witness_role: role("witness-reviewer"),
        max_obligations: 32,
        max_coverage_rounds: 2,
        max_coverage_findings: 16,
        allowed_attack_modes: ["EDGE_CASE", "FINITE_SEARCH"],
        max_attacks_per_obligation: 2,
        max_active_certification_jobs: 2,
      },
    } },
    default_research_profile: "certified",
  })
  const references = createLegacyReferenceSnapshot([])
  const profile = resolveResearchProfileSnapshot({
    config,
    directory: process.cwd(),
    reference_snapshot: references,
    resolve_agent_model: (agent) => ({ providerID: "resolved", modelID: agent }),
  })
  return createInitialCampaignState({
    campaign_id: "campaign-certified",
    parent_session_id: "ses_parent",
    source_snapshot: buildCampaignSourceSnapshot({
      objective: { kind: "markdown", instruction: "Prove it." },
      profile,
      references,
    }),
  })
}

function legacyState() {
  const references = referenceSnapshot()
  return createInitialCampaignState({
    campaign_id: "campaign-legacy",
    parent_session_id: "ses_parent",
    source_snapshot: buildCampaignSourceSnapshot({
      objective: objectiveSnapshot(),
      profile: profileSnapshot(references),
      references,
    }),
  })
}

function withProfileBytes(state: ReturnType<typeof enabledState>, serializedBytes: string) {
  return {
    ...state,
    source_snapshot: {
      ...state.source_snapshot,
      profile: {
        ...state.source_snapshot.profile,
        serialized_bytes: serializedBytes,
        sha256: CampaignHashSchema.parse(sha256(serializedBytes)),
      },
    },
  }
}

function rebindInnerHashes(serializedBytes: string): string {
  const certificationStart = serializedBytes.indexOf('"certification":') + '"certification":'.length
  const certificationHashStart = serializedBytes.indexOf(',"certification_profile_hash"', certificationStart)
  const certificationCore = `${serializedBytes.slice(certificationStart, certificationHashStart)}}`
  const certificationBound = serializedBytes.replace(
    /"certification_profile_hash":"[a-f0-9]{64}"/,
    `"certification_profile_hash":"${sha256(certificationCore)}"`,
  )
  const profileCore = `${certificationBound.slice(0, certificationBound.indexOf(',"profile_hash"'))}}`
  return certificationBound.replace(
    /"profile_hash":"[a-f0-9]{64}"/,
    `"profile_hash":"${sha256(profileCore)}"`,
  )
}
