import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { parse as parseJsonc } from "jsonc-parser"
import { z } from "zod"

import { OpenMathConfigSchema } from "../../config/schema"
import { OPENMATH_RESEARCH_COMMAND_DEFINITIONS } from "../../features/builtin-commands/research-command-definitions"
import { createOpenMathResearchTools } from "../../tools/openmath-research-tools"
import { OpenMathResearchAbortInputSchema } from "../../tools/openmath-research-abort"
import { OpenMathResearchAmendInputSchema } from "../../tools/openmath-research-amend"
import { OpenMathResearchPromoteInputSchema } from "../../tools/openmath-research-promote"
import { OpenMathResearchStartInputSchema } from "../../tools/openmath-research-start"
import { OpenMathResearchStatusInputSchema } from "../../tools/openmath-research-status"
import { OpenMathResearchStepInputSchema } from "../../tools/openmath-research-step"
import { loadReferenceSnapshot } from "../references/snapshot"
import { createOhMyOpenCodeJsonSchema } from "../../../script/build-schema-document"
import { resolveResearchProfileSnapshot } from "./profile-snapshot"

const repositoryDirectory = join(import.meta.dir, "../../..")
const exampleDirectory = join(repositoryDirectory, "docs/examples/openmath-research-campaign")
const expectedToolNames = [
  "openmath_research_start",
  "openmath_research_status",
  "openmath_research_step",
  "openmath_research_amend",
  "openmath_research_promote",
  "openmath_research_abort",
] as const
const expectedCommandNames = expectedToolNames.map((name) => name.replace(/_/g, "-"))
const expectedOpenMathProperties = [
  "max_review_rounds",
  "max_consecutive_patch_failures",
  "artifacts",
  "workflow_profiles",
  "default_workflow_profile",
  "research_profiles",
  "default_research_profile",
  "workflow_allowed_roots",
  "state_filename_mode",
  "default_mode",
  "solve_only",
  "export",
] as const

const ToolSequenceSchema = z.array(z.discriminatedUnion("tool", [
  route("openmath_research_start", "openmath-research-start", OpenMathResearchStartInputSchema),
  route("openmath_research_status", "openmath-research-status", OpenMathResearchStatusInputSchema),
  route("openmath_research_step", "openmath-research-step", OpenMathResearchStepInputSchema),
  route("openmath_research_amend", "openmath-research-amend", OpenMathResearchAmendInputSchema),
  route("openmath_research_promote", "openmath-research-promote", OpenMathResearchPromoteInputSchema),
  route("openmath_research_abort", "openmath-research-abort", OpenMathResearchAbortInputSchema),
])).length(6).readonly()

const GeneratedSchemaShape = z.object({
  properties: z.object({
    disabled_commands: z.object({ items: z.object({ enum: z.array(z.string()) }).loose() }).loose(),
    disabled_tools: z.object({
      items: z.object({
        anyOf: z.array(z.object({ enum: z.array(z.string()).optional() }).loose()),
      }).loose(),
    }).loose(),
    openmath: z.object({
      properties: z.record(z.string(), z.unknown()),
    }).loose(),
  }).loose(),
}).loose()

describe("OpenMath research campaign documentation examples", () => {
  test("parses the Phase A profile, prompt sources, references, and runtime snapshot", () => {
    const config = fixtureConfig()
    const references = loadReferenceSnapshot({
      referenceManifestPath: join(exampleDirectory, "references.yaml"),
      projectDirectory: exampleDirectory,
      configuredAllowedRoots: ["."],
    })

    const snapshot = resolveResearchProfileSnapshot({
      config,
      directory: exampleDirectory,
      reference_snapshot: references,
      resolve_agent_model: (agent) => ({ providerID: "fixture", modelID: agent }),
    })

    expect(snapshot.name).toBe("phase-a-documentation-example")
    expect(snapshot.candidate_workflow_profile.checkpoint).toBe("after_solve")
    expect(snapshot.strategies.map((strategy) => strategy.prompt.kind)).toEqual(["file", "file"])
    expect(snapshot.screening_roles.map((role) => role.prompt.kind)).toEqual(["file"])
    expect(snapshot.tournament_role.prompt.kind).toBe("file")
    expect(snapshot.reference_snapshot.references).toHaveLength(1)
    expect(Object.isFrozen(snapshot)).toBe(true)
  })

  test("binds the fixture to the exact six public tool and command routes", () => {
    const config = fixtureConfig()
    const sequence = ToolSequenceSchema.parse(JSON.parse(readFileSync(
      join(exampleDirectory, "expected-tool-sequence.json"),
      "utf8",
    )))
    const toolNames = Object.keys(createOpenMathResearchTools({
      directory: exampleDirectory,
      openmathConfig: config,
    }))
    const commandNames = Object.keys(OPENMATH_RESEARCH_COMMAND_DEFINITIONS)

    expect(sequence.map((entry) => entry.tool)).toEqual(expectedToolNames)
    expect(sequence.map((entry) => entry.command)).toEqual(expectedCommandNames)
    expect(toolNames).toEqual(expectedToolNames)
    expect(commandNames).toEqual(expectedCommandNames)
    expect(commandNames.map((name) => name.replace(/-/g, "_"))).toEqual(toolNames)
  })

  test("rejects Phase B-D profile keys, incompatible checkpoints, and nonexistent routes", () => {
    const raw = fixtureConfigValue()
    const profile = raw.research_profiles["phase-a-documentation-example"]
    const workflow = raw.workflow_profiles["research-candidate"]
    const forbiddenKeys = ["obligations", "counterexample", "formal_verifier", "independence_group", "novelty"]

    expect(forbiddenKeys.every((key) => !OpenMathConfigSchema.safeParse({
      ...raw,
      research_profiles: { "phase-a-documentation-example": { ...profile, [key]: {} } },
    }).success)).toBe(true)
    expect(OpenMathConfigSchema.parse({
      ...raw,
      workflow_profiles: { "research-candidate": { ...workflow, checkpoint: "after_review" } },
    })).toBeDefined()
    expect(() => resolveFixtureSnapshot({
      ...raw,
      workflow_profiles: { "research-candidate": { ...workflow, checkpoint: "after_review" } },
    })).toThrow()
    expect(ToolSequenceSchema.safeParse([{ tool: "canonical_promote", command: "canonical-promote", input: {} }]).success).toBe(false)
  })

  test("publishes the canonical generated schema with only Phase A research fields", () => {
    const generated = GeneratedSchemaShape.parse(createOhMyOpenCodeJsonSchema())
    const asset = GeneratedSchemaShape.parse(JSON.parse(readFileSync(
      join(repositoryDirectory, "assets/oh-my-openmath.schema.json"),
      "utf8",
    )))
    const profileFields = Object.keys(z.object({
      additionalProperties: z.object({ properties: z.record(z.string(), z.unknown()) }).loose(),
    }).parse(generated.properties.openmath.properties.research_profiles).additionalProperties.properties)
    const researchTools = generated.properties.disabled_tools.items.anyOf
      .flatMap((branch) => branch.enum ?? [])
      .filter((name) => name.startsWith("openmath_research_"))
    const researchCommands = generated.properties.disabled_commands.items.enum
      .filter((name) => name.startsWith("openmath-research-"))

    expect(Object.keys(generated.properties.openmath.properties)).toEqual(expectedOpenMathProperties)
    expect(Object.keys(asset.properties.openmath.properties)).toEqual(expectedOpenMathProperties)
    expect(profileFields).toEqual([
      "candidate_workflow_profile",
      "strategies",
      "candidates_per_strategy",
      "screening_roles",
      "max_active_candidates",
      "survivor_limit",
      "tournament_role",
    ])
    expect(researchTools).toEqual(expectedToolNames)
    expect(researchCommands).toEqual(expectedCommandNames)
    expect(asset).toEqual(generated)
  })

  test("rejects an unsupported top-level OpenMath property", () => {
    const generated = createOhMyOpenCodeJsonSchema()
    const injected = JSON.parse(JSON.stringify(generated))
    injected.properties.openmath.properties.obligations = { type: "object" }

    expect(GeneratedSchemaShape.parse(injected)).toBeDefined()
    expect(Object.keys(injected.properties.openmath.properties)).not.toEqual(expectedOpenMathProperties)
  })

  test.skipIf(process.env.OPENMATH_RESEARCH_DOCS_FAILURE_PROBE === undefined)("fails structurally for the selected invalid fixture probe", () => {
    const raw = fixtureConfigValue()
    const probe = process.env.OPENMATH_RESEARCH_DOCS_FAILURE_PROBE
    if (probe === "phase-b") {
      const profile = raw.research_profiles["phase-a-documentation-example"]
      OpenMathConfigSchema.parse({
        ...raw,
        research_profiles: { "phase-a-documentation-example": { ...profile, obligations: {} } },
      })
      return
    }
    if (probe === "checkpoint") {
      const workflow = raw.workflow_profiles["research-candidate"]
      resolveFixtureSnapshot({
        ...raw,
        workflow_profiles: { "research-candidate": { ...workflow, checkpoint: "after_review" } },
      })
      return
    }
    ToolSequenceSchema.parse([{ tool: "canonical_promote", command: "canonical-promote", input: {} }])
  })
})

function route<T extends z.ZodType>(tool: string, command: string, input: T) {
  return z.object({ tool: z.literal(tool), command: z.literal(command), input }).strict()
}

function fixtureConfigValue() {
  return parseJsonc(readFileSync(join(exampleDirectory, "profile.jsonc"), "utf8"))
}

function fixtureConfig() {
  return OpenMathConfigSchema.parse(fixtureConfigValue())
}

function resolveFixtureSnapshot(value: unknown) {
  return resolveResearchProfileSnapshot({
    config: OpenMathConfigSchema.parse(value),
    directory: exampleDirectory,
    reference_snapshot: loadReferenceSnapshot({
      referenceManifestPath: join(exampleDirectory, "references.yaml"),
      projectDirectory: exampleDirectory,
      configuredAllowedRoots: ["."],
    }),
    resolve_agent_model: (agent) => ({ providerID: "fixture", modelID: agent }),
  })
}
