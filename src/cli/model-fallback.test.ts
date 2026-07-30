import { describe, expect, test } from "bun:test"

import { createInstallConfig } from "./install-config.test-fixture"
import { generateModelConfig } from "./model-fallback"

describe("generateModelConfig", () => {
  describe("no providers available", () => {
    test("returns ULTIMATE_FALLBACK for all agents and categories when no providers", () => {
      expect(generateModelConfig(createInstallConfig())).toMatchSnapshot()
    })
  })

  describe("schema URL", () => {
    test("always includes correct schema URL", () => {
      expect(generateModelConfig(createInstallConfig()).$schema).toBe("https://raw.githubusercontent.com/code-yeongyu/oh-my-opencode/master/assets/oh-my-openmath.schema.json")
    })
  })
})
