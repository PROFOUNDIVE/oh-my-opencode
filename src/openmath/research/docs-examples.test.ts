import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { z } from "zod"

import { OpenMathConfigSchema } from "../../config/schema"
import { OPENMATH_RESEARCH_COMMAND_DEFINITIONS } from "../../features/builtin-commands/research-command-definitions"
import { createOpenMathResearchTools } from "../../tools/openmath-research-tools"
import { OpenMathResearchEnabledAbortInputSchema, OpenMathResearchPhaseAAbortInputSchema } from "../../tools/openmath-research-abort/types"
import { OpenMathResearchEnabledAmendInputSchema, OpenMathResearchPhaseAAmendInputSchema } from "../../tools/openmath-research-amend/types"
import { OpenMathResearchEnabledPromoteInputSchema, OpenMathResearchPhaseAPromoteInputSchema } from "../../tools/openmath-research-promote/types"
import { OpenMathResearchStartInputSchema } from "../../tools/openmath-research-start"
import { OpenMathResearchStatusInputSchema } from "../../tools/openmath-research-status"
import { OpenMathResearchEnabledStepInputSchema, OpenMathResearchPhaseAStepInputSchema } from "../../tools/openmath-research-step/types"
import { createOhMyOpenCodeJsonSchema } from "../../../script/build-schema-document"
import { exampleDirectory, fixtureConfig, fixtureConfigValue, generatedSchemaShape, resolveFixtureSnapshot } from "./docs-examples-fixture"

const repositoryDirectory = join(import.meta.dir, "../../..")
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

const EnabledToolSequenceSchema = z.array(z.discriminatedUnion("tool", [
  route("openmath_research_start", "openmath-research-start", OpenMathResearchStartInputSchema),
  route("openmath_research_status", "openmath-research-status", OpenMathResearchStatusInputSchema),
  route("openmath_research_step", "openmath-research-step", OpenMathResearchEnabledStepInputSchema),
  route("openmath_research_amend", "openmath-research-amend", OpenMathResearchEnabledAmendInputSchema),
  route("openmath_research_promote", "openmath-research-promote", OpenMathResearchEnabledPromoteInputSchema),
  route("openmath_research_abort", "openmath-research-abort", OpenMathResearchEnabledAbortInputSchema),
])).length(6).readonly()

describe("OpenMath research campaign documentation examples", () => {
  test("parses the Phase A profile, prompt sources, references, and runtime snapshot", () => {
    const config = fixtureConfig()
    const snapshot = resolveFixtureSnapshot(config)

    expect(snapshot.name).toBe("phase-a-documentation-example")
    expect(snapshot.candidate_workflow_profile.checkpoint).toBe("after_solve")
    expect(snapshot.strategies.map((strategy) => strategy.prompt.kind)).toEqual(["file", "file"])
    expect(snapshot.screening_roles.map((role) => role.prompt.kind)).toEqual(["file"])
    expect(snapshot.tournament_role.prompt.kind).toBe("file")
    expect(snapshot.reference_snapshot.references).toHaveLength(1)
    expect(Object.isFrozen(snapshot)).toBe(true)
  })

  test("parses the opt-in Phase B profile with four certification roles and bounded settings", () => {
    const raw = fixtureConfigValue()
    const parsed = OpenMathConfigSchema.parse(raw)
    if (parsed.research_profiles === undefined) throw new Error("Research profiles are missing")
    const profile = parsed.research_profiles["phase-b-certification-example"]
    if (profile === undefined) throw new Error("Phase B fixture profile is missing")
    if (profile.certification === undefined) throw new Error("Phase B certification block is missing")
    const certification = profile.certification
    expect(certification.schema_version).toBe(1)
    expect(certification.max_obligations).toBe(8)
    expect(certification.max_coverage_rounds).toBe(2)
    expect(certification.max_coverage_findings).toBe(16)
    expect(certification.allowed_attack_modes).toEqual(["EDGE_CASE", "FINITE_SEARCH"])
    expect(certification.max_attacks_per_obligation).toBe(2)
    expect(certification.max_active_certification_jobs).toBe(2)
    const rolePrompts = [
      certification.extraction_role.prompt,
      certification.coverage_role.prompt,
      certification.counterexample_role.prompt,
      certification.witness_role.prompt,
    ]
    expect(rolePrompts.every((prompt) => prompt.kind === "file")).toBe(true)
    const snapshot = resolveFixtureSnapshot({ ...raw, default_research_profile: "phase-b-certification-example" })
    expect(snapshot.certification?.extraction_role.prompt.kind).toBe("file")
    expect(snapshot.certification?.coverage_role.prompt.kind).toBe("file")
    expect(snapshot.certification?.counterexample_role.prompt.kind).toBe("file")
    expect(snapshot.certification?.witness_role.prompt.kind).toBe("file")
  })

  test("binds Phase A and enabled examples to their exact six public routes", () => {
    const config = fixtureConfig()
    const sequence = EnabledToolSequenceSchema.parse(JSON.parse(readFileSync(
      join(exampleDirectory, "expected-tool-sequence.json"),
      "utf8",
    )))
    const toolNames = Object.keys(createOpenMathResearchTools({
      directory: exampleDirectory,
      openmathConfig: config,
    }))
    const commandNames = Object.keys(OPENMATH_RESEARCH_COMMAND_DEFINITIONS)

    expect(sequence.map((entry) => entry.tool)).toEqual([...expectedToolNames])
    expect(sequence.map((entry) => entry.command)).toEqual([...expectedCommandNames])
    expect(toolNames).toEqual([...expectedToolNames])
    expect(commandNames).toEqual(expectedCommandNames)
    expect(commandNames.map((name) => name.replace(/-/g, "_"))).toEqual(toolNames)
    expect([
      OpenMathResearchPhaseAStepInputSchema.safeParse({ campaign_id: "phase-a-example", expected_state_revision: 0 }),
      OpenMathResearchPhaseAAmendInputSchema.safeParse({ campaign_id: "phase-a-example", expected_state_revision: 1, operation: "add", kind: "required_check", scope: "all_candidates", content: "Check every boundary case." }),
      OpenMathResearchPhaseAPromoteInputSchema.safeParse({ campaign_id: "phase-a-example", expected_state_revision: 2, dossier_sha256: "0".repeat(64), decision: "approve" }),
      OpenMathResearchPhaseAAbortInputSchema.safeParse({ campaign_id: "phase-a-example", expected_state_revision: 2 }),
    ].every((result) => result.success)).toBe(true)
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
    expect(EnabledToolSequenceSchema.safeParse([{ tool: "canonical_promote", command: "canonical-promote", input: {} }]).success).toBe(false)
  })

  test("publishes the canonical generated schema with only Phase A research fields", () => {
    const generated = generatedSchemaShape.parse(createOhMyOpenCodeJsonSchema())
    const asset = generatedSchemaShape.parse(JSON.parse(readFileSync(
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

    expect(Object.keys(generated.properties.openmath.properties)).toEqual([...expectedOpenMathProperties])
    expect(Object.keys(asset.properties.openmath.properties)).toEqual([...expectedOpenMathProperties])
    expect(profileFields).toEqual([
      "candidate_workflow_profile",
      "strategies",
      "candidates_per_strategy",
      "screening_roles",
      "max_active_candidates",
      "survivor_limit",
      "tournament_role",
      "certification",
    ])
    expect(researchTools).toEqual([...expectedToolNames])
    expect(researchCommands).toEqual([...expectedCommandNames])
    expect(asset).toEqual(generated)
  })

  test("rejects an unsupported top-level OpenMath property", () => {
    const raw = fixtureConfigValue()
    const result = OpenMathConfigSchema.strict().safeParse({ ...raw, obligations: {} })

    if (result.success) throw new Error("Unsupported top-level OpenMath property was accepted")
    expect(result.error.issues.some((issue) =>
      issue.code === "unrecognized_keys" && issue.path.length === 0 && issue.keys.includes("obligations")
    )).toBe(true)
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
    EnabledToolSequenceSchema.parse([{ tool: "canonical_promote", command: "canonical-promote", input: {} }])
  })
})

function route<T extends z.ZodType>(tool: string, command: string, input: T) {
  return z.object({ tool: z.literal(tool), command: z.literal(command), input }).strict()
}
