import { readFileSync } from "node:fs"
import { join } from "node:path"
import { parse as parseJsonc } from "jsonc-parser"
import { z } from "zod"

import { OpenMathConfigSchema } from "../../config/schema"
import { loadReferenceSnapshot } from "../references/snapshot"
import { resolveResearchProfileSnapshot } from "./profile-snapshot"

const repositoryDirectory = join(import.meta.dir, "../../..")
export const exampleDirectory = join(repositoryDirectory, "docs/examples/openmath-research-campaign")

export const generatedSchemaShape = z.object({
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

export function fixtureConfigValue() {
  return parseJsonc(readFileSync(join(exampleDirectory, "profile.jsonc"), "utf8"))
}

export function fixtureConfig() {
  return OpenMathConfigSchema.parse(fixtureConfigValue())
}

export function resolveFixtureSnapshot(value: unknown) {
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
