import { describe, expect, test } from "bun:test"

import { researchToolConfig } from "./openmath-research-test-support"
import { createOpenMathResearchTools } from "./openmath-research-tools"

const RESEARCH_TOOL_KEYS = [
  "openmath_research_start",
  "openmath_research_status",
  "openmath_research_step",
  "openmath_research_amend",
  "openmath_research_promote",
  "openmath_research_abort",
] as const

describe("createOpenMathResearchTools", () => {
  test("registers exactly six independent research tools", () => {
    const tools = createOpenMathResearchTools({
      directory: process.cwd(),
      openmathConfig: researchToolConfig(),
    })

    expect(Object.keys(tools)).toEqual(RESEARCH_TOOL_KEYS)
    expect(new Set(Object.values(tools)).size).toBe(6)
  })
})
