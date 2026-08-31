import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"

import { OpenMathConfigSchema } from "../../config/schema"
import { createLegacyReferenceSnapshot } from "../references/snapshot"
import { resolveResearchProfileSnapshot } from "./profile-snapshot"

const workflow = {
  solve: { agent: "solver", prompt: { kind: "inline", content: "solve" }, output_adapter: "opaque_markdown" },
  review: { agent: "reviewer", prompt: { kind: "inline", content: "review" }, output_adapter: "review_verdict_markdown" },
  revise: { agent: "reviser", prompt: { kind: "inline", content: "revise" }, output_adapter: "full_replace_markdown" },
  min_review_rounds: 1,
  max_review_rounds: 2,
  required_consecutive_passes: 1,
  checkpoint: "after_solve",
}

const role = (agent: string) => ({ agent, prompt: { kind: "inline", content: `${agent}-prompt` } })
const certification = {
  schema_version: 1,
  extraction_role: role("extractor"),
  coverage_role: role("coverage-reviewer"),
  counterexample_role: role("attacker"),
  witness_role: role("witness-reviewer"),
  max_obligations: 64,
  max_coverage_rounds: 3,
  max_coverage_findings: 32,
  allowed_attack_modes: ["EDGE_CASE", "FINITE_SEARCH", "ASSUMPTION_REMOVAL"],
  max_attacks_per_obligation: 2,
  max_active_certification_jobs: 4,
}

type BoundedField = "max_obligations" | "max_coverage_rounds" | "max_coverage_findings"
  | "max_attacks_per_obligation" | "max_active_certification_jobs"

const boundedCases = [
  ["max_obligations", 0], ["max_obligations", 257], ["max_coverage_rounds", 0], ["max_coverage_rounds", 6],
  ["max_coverage_findings", 0], ["max_coverage_findings", 257], ["max_attacks_per_obligation", 0], ["max_attacks_per_obligation", 8],
  ["max_active_certification_jobs", 0], ["max_active_certification_jobs", 17],
] satisfies ReadonlyArray<readonly [BoundedField, number]>

const profile = {
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
}

function parseCertification(value: object) {
  return OpenMathConfigSchema.safeParse({
    workflow_profiles: { candidate: workflow },
    research_profiles: { certified: { ...profile, certification: value } },
  })
}

describe("research certification profile configuration", () => {
  test("keeps the absent certification snapshot in the exact Phase-A key order", () => {
    const config = OpenMathConfigSchema.parse({
      workflow_profiles: { candidate: workflow },
      research_profiles: { legacy: profile },
      default_research_profile: "legacy",
    })

    const snapshot = resolveResearchProfileSnapshot({
      config,
      directory: process.cwd(),
      reference_snapshot: createLegacyReferenceSnapshot([]),
      resolve_agent_model: (agent) => ({ providerID: "resolved", modelID: agent }),
    })

    expect(Object.keys(snapshot)).toEqual([
      "snapshot_version", "name", "candidate_workflow_profile", "candidate_workflow_profile_hash",
      "strategies", "candidates_per_strategy", "screening_roles", "max_active_candidates",
      "survivor_limit", "tournament_role", "profile_hash", "reference_snapshot",
    ])
    expect(JSON.stringify(snapshot)).not.toContain('"certification"')
  })

  test("accepts the exact bounded certification block", () => {
    expect(parseCertification(certification).success).toBe(true)
  })

  test.each<[BoundedField, number]>(boundedCases)("rejects %s=%s at its exact path", (field, value) => {
    const result = parseCertification({ ...certification, [field]: value })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["research_profiles", "certified", "certification", field])
    }
  })

  test("rejects duplicate modes and a total cap above the unique mode count", () => {
    const duplicate = parseCertification({
      ...certification,
      allowed_attack_modes: ["EDGE_CASE", "FINITE_SEARCH", "EDGE_CASE"],
    })
    const excessive = parseCertification({ ...certification, max_attacks_per_obligation: 4 })

    expect(duplicate.success).toBe(false)
    expect(excessive.success).toBe(false)
    if (!duplicate.success) {
      expect(duplicate.error.issues.map((issue) => issue.path)).toContainEqual([
        "research_profiles", "certified", "certification", "allowed_attack_modes", 2,
      ])
    }
    if (!excessive.success) {
      expect(excessive.error.issues[0]?.path).toEqual([
        "research_profiles", "certified", "certification", "max_attacks_per_obligation",
      ])
    }
  })

  test.each(["backend", "command", "network", "independence", "adaptive", "unknown"])(
    "rejects untrusted certification field %s at the certification boundary",
    (field: string) => {
      const result = parseCertification({ ...certification, [field]: {} })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues[0]?.path).toEqual(["research_profiles", "certified", "certification"])
      }
    },
  )

  test("rejects command prompts and variants without explicit models at exact role paths", () => {
    const command = parseCertification({
      ...certification,
      extraction_role: { agent: "extractor", prompt: { kind: "command", command: "run" } },
    })
    const variant = parseCertification({ ...certification, witness_role: { ...role("witness"), variant: "high" } })

    expect(command.success).toBe(false)
    expect(variant.success).toBe(false)
    if (!command.success) {
      expect(command.error.issues[0]?.path).toEqual([
        "research_profiles", "certified", "certification", "extraction_role", "prompt", "kind",
      ])
    }
    if (!variant.success) {
      expect(variant.error.issues[0]?.path).toEqual([
        "research_profiles", "certified", "certification", "witness_role", "variant",
      ])
    }
  })

  test("resolves and freezes all four certification roles with nested hashes", () => {
    const calls: string[] = []
    const config = OpenMathConfigSchema.parse({
      workflow_profiles: { candidate: workflow },
      research_profiles: { certified: { ...profile, certification } },
      default_research_profile: "certified",
    })

    const snapshot = resolveResearchProfileSnapshot({
      config,
      directory: process.cwd(),
      reference_snapshot: createLegacyReferenceSnapshot([]),
      resolve_agent_model: (agent) => {
        calls.push(agent)
        return { providerID: "resolved", modelID: agent }
      },
    })
    const certificationSnapshot = snapshot.certification
    if (certificationSnapshot === undefined) throw new TypeError("Certification snapshot is missing")
    const { certification_profile_hash: certificationHash, ...certificationCore } = certificationSnapshot

    expect(calls).toEqual([
      "solver", "reviewer", "reviser", "screen-reviewer", "tournament-reviewer",
      "extractor", "coverage-reviewer", "attacker", "witness-reviewer",
    ])
    expect(certificationHash).toBe(createHash("sha256").update(JSON.stringify(certificationCore), "utf8").digest("hex"))
    expect([
      certificationSnapshot.extraction_role,
      certificationSnapshot.coverage_role,
      certificationSnapshot.counterexample_role,
      certificationSnapshot.witness_role,
    ].map((resolved) => resolved.prompt.content_hash)).toEqual([
      "extractor-prompt", "coverage-reviewer-prompt", "attacker-prompt", "witness-reviewer-prompt",
    ].map((prompt) => createHash("sha256").update(prompt, "utf8").digest("hex")))
    expect(Object.isFrozen(snapshot)).toBe(true)
  })
})
