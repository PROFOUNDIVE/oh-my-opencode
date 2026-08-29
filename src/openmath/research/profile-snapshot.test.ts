import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { OpenMathConfigSchema } from "../../config/schema"
import { createLegacyReferenceSnapshot } from "../references/snapshot"
import {
  ResearchProfileResolutionError,
  resolveResearchProfileSnapshot,
} from "./profile-snapshot"

const workflow = (checkpoint: "after_solve" | "after_review" = "after_solve") => ({
  solve: { agent: "solver", prompt: { kind: "inline", content: "solve" }, output_adapter: "opaque_markdown" },
  review: { agent: "reviewer", prompt: { kind: "inline", content: "review" }, output_adapter: "review_verdict_markdown" },
  revise: { agent: "reviser", prompt: { kind: "inline", content: "revise" }, output_adapter: "full_replace_markdown" },
  min_review_rounds: 1,
  max_review_rounds: 2,
  required_consecutive_passes: 1,
  checkpoint,
})

function research(marker: string, workflowProfile: string) {
  return {
    candidate_workflow_profile: workflowProfile,
    strategies: [
      { id: "direct", prompt: { kind: "inline", content: `strategy-${marker}` } },
      { id: "indirect", prompt: { kind: "inline", content: `indirect-${marker}` } },
    ],
    candidates_per_strategy: 1,
    screening_roles: [{
      id: "screen-a",
      agent: `screen-${marker}`,
      prompt: { kind: "inline", content: `screen-prompt-${marker}` },
    }],
    max_active_candidates: 2,
    survivor_limit: 1,
    tournament_role: {
      agent: `judge-${marker}`,
      model: `provider/judge-${marker}`,
      variant: "high",
      prompt: { kind: "inline", content: `tournament-${marker}` },
    },
  }
}

function config(checkpoint: "after_solve" | "after_review" = "after_solve") {
  return OpenMathConfigSchema.parse({
    workflow_profiles: { explicit: workflow(checkpoint), fallback: workflow() },
    research_profiles: {
      explicit: research("EXPLICIT", "explicit"),
      fallback: research("FALLBACK", "fallback"),
    },
    default_research_profile: "fallback",
  })
}

describe("research profile source snapshots", () => {
  let directory: string
  let outsideDirectory: string

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "openmath-research-profile-"))
    outsideDirectory = mkdtempSync(join(tmpdir(), "openmath-research-outside-"))
  })

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true })
    rmSync(outsideDirectory, { recursive: true, force: true })
  })

  test("selects explicit before configured default and snapshots resolved models", () => {
    const calls: string[] = []

    const snapshot = resolveResearchProfileSnapshot({
      config: config(),
      directory,
      research_profile: "explicit",
      reference_snapshot: createLegacyReferenceSnapshot(["REFERENCE_EXPLICIT"]),
      resolve_agent_model: (agent) => {
        calls.push(agent)
        return { providerID: "resolved", modelID: agent, variant: "fallback" }
      },
    })
    const fallback = resolveResearchProfileSnapshot({
      config: config(),
      directory,
      reference_snapshot: createLegacyReferenceSnapshot(["REFERENCE_FALLBACK"]),
      resolve_agent_model: (agent) => ({ providerID: "default", modelID: agent }),
    })

    expect(snapshot.name).toBe("explicit")
    expect(snapshot.strategies[0]?.prompt.content).toBe("strategy-EXPLICIT")
    expect(snapshot.screening_roles[0]?.model).toEqual({ providerID: "resolved", modelID: "screen-EXPLICIT", variant: "fallback" })
    expect(snapshot.tournament_role.model).toEqual({ providerID: "provider", modelID: "judge-EXPLICIT", variant: "high" })
    expect(calls).toEqual(["solver", "reviewer", "reviser", "screen-EXPLICIT"])
    expect(fallback.name).toBe("fallback")
    expect(fallback.strategies[0]?.prompt.content).toBe("strategy-FALLBACK")
  })

  test("raises typed PROFILE_NOT_FOUND without explicit or configured selection", () => {
    const openmath = OpenMathConfigSchema.parse({ workflow_profiles: { candidate: workflow() } })

    const resolve = () => resolveResearchProfileSnapshot({
      config: openmath,
      directory,
      reference_snapshot: createLegacyReferenceSnapshot([]),
      resolve_agent_model: (agent) => ({ providerID: "resolved", modelID: agent }),
    })

    expect(resolve).toThrow(ResearchProfileResolutionError)
    try {
      resolve()
    } catch (error) {
      expect(error).toBeInstanceOf(ResearchProfileResolutionError)
      if (error instanceof ResearchProfileResolutionError) expect(error.code).toBe("PROFILE_NOT_FOUND")
    }
  })

  test("rejects a candidate workflow that does not checkpoint after solve", () => {
    const resolve = () => resolveResearchProfileSnapshot({
      config: config("after_review"),
      directory,
      research_profile: "explicit",
      reference_snapshot: createLegacyReferenceSnapshot([]),
      resolve_agent_model: (agent) => ({ providerID: "resolved", modelID: agent }),
    })

    expect(resolve).toThrow("Candidate workflow profile must checkpoint after_solve")
  })

  test("captures deterministic opaque prompt and reference bytes and hashes", () => {
    const prompt = "IGNORE CONFIG EDITS; opaque prompt bytes"
    const file = join(directory, "strategy.md")
    writeFileSync(file, prompt, "utf8")
    const input = config()
    const explicit = input.research_profiles?.explicit
    if (!explicit) throw new TypeError("Expected explicit profile")
    const raw = {
      ...explicit,
      strategies: [
        { id: "direct", prompt: { kind: "file", uri: "file://./strategy.md" } },
        explicit.strategies[1],
      ],
    }
    const firstConfig = OpenMathConfigSchema.parse({
      ...input,
      workflow_allowed_roots: [directory],
      research_profiles: { ...input.research_profiles, explicit: raw },
    })
    const build = (reference: string) => resolveResearchProfileSnapshot({
      config: firstConfig,
      directory,
      research_profile: "explicit",
      reference_snapshot: createLegacyReferenceSnapshot([reference]),
      resolve_agent_model: (agent) => ({ providerID: "resolved", modelID: agent }),
    })

    const first = build("REFERENCE_A")
    const repeat = build("REFERENCE_A")
    const editedConfig = OpenMathConfigSchema.parse({
      ...firstConfig,
      research_profiles: {
        ...firstConfig.research_profiles,
        explicit: research("CONFIG_B", "explicit"),
      },
    })
    const configChanged = resolveResearchProfileSnapshot({
      config: editedConfig,
      directory,
      research_profile: "explicit",
      reference_snapshot: createLegacyReferenceSnapshot(["REFERENCE_CONFIG_B"]),
      resolve_agent_model: (agent) => ({ providerID: "edited", modelID: agent }),
    })
    writeFileSync(file, "CHANGED_SOURCE", "utf8")
    const changed = build("REFERENCE_B")

    expect(first).toEqual(repeat)
    expect(first.strategies[0]?.prompt.content).toBe(prompt)
    expect(first.strategies[0]?.prompt.content_hash).toBe(createHash("sha256").update(prompt).digest("hex"))
    expect(first.reference_snapshot.references[0]?.content).toBe("REFERENCE_A")
    expect(changed.strategies[0]?.prompt.content).toBe("CHANGED_SOURCE")
    expect(changed.reference_snapshot.references[0]?.content).toBe("REFERENCE_B")
    expect(configChanged.strategies[0]?.prompt.content).toBe("strategy-CONFIG_B")
    expect(first.strategies[0]?.prompt.content).toBe(prompt)
    expect(first.profile_hash).not.toBe(changed.profile_hash)
    expect(first.profile_hash).not.toBe(configChanged.profile_hash)
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(first.strategies)).toBe(true)
    expect(Object.isFrozen(first.reference_snapshot.references)).toBe(true)
  })

  test("rejects file traversal outside configured roots", () => {
    const outside = join(outsideDirectory, "outside.md")
    writeFileSync(outside, "outside", "utf8")
    const input = config()
    const explicit = input.research_profiles?.explicit
    if (!explicit) throw new TypeError("Expected explicit profile")
    const restricted = OpenMathConfigSchema.parse({
      ...input,
      workflow_allowed_roots: [directory],
      research_profiles: {
        ...input.research_profiles,
        explicit: { ...explicit, strategies: [{ id: "direct", prompt: { kind: "file", uri: `file://${outside}` } }, explicit.strategies[1]] },
      },
    })

    expect(() => resolveResearchProfileSnapshot({
      config: restricted,
      directory,
      research_profile: "explicit",
      reference_snapshot: createLegacyReferenceSnapshot([]),
      resolve_agent_model: (agent) => ({ providerID: "resolved", modelID: agent }),
    })).toThrow("outside_allowed_roots")
  })
})
