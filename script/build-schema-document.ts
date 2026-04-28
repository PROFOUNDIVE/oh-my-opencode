import * as z from "zod"
import { OhMyOpenCodeConfigSchema } from "../src/config/schema"

export function createOhMyOpenCodeJsonSchema(): Record<string, unknown> {
  const jsonSchema = z.toJSONSchema(OhMyOpenCodeConfigSchema, {
    unrepresentable: "any",
  })

  return {
    ...jsonSchema,
    $schema: "http://json-schema.org/draft-07/schema#",
    $id: "https://raw.githubusercontent.com/code-yeongyu/oh-my-opencode/master/assets/oh-my-openmath.schema.json",
    title: "Oh My OpenMath Configuration",
    description: "Configuration schema for oh-my-openmath plugin",
  }
}
