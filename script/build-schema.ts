#!/usr/bin/env bun
import { createOhMyOpenCodeJsonSchema } from "./build-schema-document"

const SCHEMA_OUTPUT_PATHS = [
  "assets/oh-my-openmath.schema.json",
  "dist/oh-my-openmath.schema.json",
]

async function main() {
  console.log("Generating JSON Schema...")

  const finalSchema = createOhMyOpenCodeJsonSchema()

  await Promise.all(
    SCHEMA_OUTPUT_PATHS.map((outputPath) =>
      Bun.write(outputPath, JSON.stringify(finalSchema, null, 2))
    )
  )

  console.log(`✓ JSON Schema generated: ${SCHEMA_OUTPUT_PATHS.join(", ")}`)
}

main()
