import { describe, expect, test } from "bun:test"
import {
  AgentOverrideConfigSchema,
  AgentOverridesSchema,
  BrowserAutomationConfigSchema,
  BrowserAutomationProviderSchema,
  BuiltinCategoryNameSchema,
  CategoryConfigSchema,
  ExperimentalConfigSchema,
  GitMasterConfigSchema,
  LocalizationConfigSchema,
  OpenMathConfigSchema,
  OhMyOpenCodeConfigSchema,
  OverridableAgentNameSchema,
  PerformanceConfigSchema,
} from "./schema"

describe("disabled_mcps schema", () => {
  test("should accept built-in MCP names", () => {
    // given
    const config = {
      disabled_mcps: ["context7", "grep_app"],
    }

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.disabled_mcps).toEqual(["context7", "grep_app"])
    }
  })

  test("should accept custom MCP names", () => {
    // given
    const config = {
      disabled_mcps: ["playwright", "sqlite", "custom-mcp"],
    }

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.disabled_mcps).toEqual(["playwright", "sqlite", "custom-mcp"])
    }
  })

  test("should accept mixed built-in and custom names", () => {
    // given
    const config = {
      disabled_mcps: ["context7", "playwright", "custom-server"],
    }

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.disabled_mcps).toEqual(["context7", "playwright", "custom-server"])
    }
  })

  test("should accept empty array", () => {
    // given
    const config = {
      disabled_mcps: [],
    }

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.disabled_mcps).toEqual([])
    }
  })

  test("should reject non-string values", () => {
    // given
    const config = {
      disabled_mcps: [123, true, null],
    }

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(false)
  })

  test("should accept undefined (optional field)", () => {
    // given
    const config = {}

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.disabled_mcps).toBeUndefined()
    }
  })

  test("should reject empty strings", () => {
    // given
    const config = {
      disabled_mcps: [""],
    }

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(false)
  })

  test("should accept MCP names with various naming patterns", () => {
    // given
    const config = {
      disabled_mcps: [
        "my-custom-mcp",
        "my_custom_mcp",
        "myCustomMcp",
        "my.custom.mcp",
        "my-custom-mcp-123",
      ],
    }

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.disabled_mcps).toEqual([
        "my-custom-mcp",
        "my_custom_mcp",
        "myCustomMcp",
        "my.custom.mcp",
        "my-custom-mcp-123",
      ])
    }
  })
})

describe("AgentOverrideConfigSchema", () => {
  describe("category field", () => {
    test("accepts category as optional string", () => {
      // given
      const config = { category: "visual-engineering" }

      // when
      const result = AgentOverrideConfigSchema.safeParse(config)

      // then
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.category).toBe("visual-engineering")
      }
    })

    test("accepts config without category", () => {
      // given
      const config = { temperature: 0.5 }

      // when
      const result = AgentOverrideConfigSchema.safeParse(config)

      // then
      expect(result.success).toBe(true)
    })

    test("rejects non-string category", () => {
      // given
      const config = { category: 123 }

      // when
      const result = AgentOverrideConfigSchema.safeParse(config)

      // then
      expect(result.success).toBe(false)
    })
  })

  describe("variant field", () => {
    test("accepts variant as optional string", () => {
      // given
      const config = { variant: "high" }

      // when
      const result = AgentOverrideConfigSchema.safeParse(config)

      // then
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.variant).toBe("high")
      }
    })

    test("rejects non-string variant", () => {
      // given
      const config = { variant: 123 }

      // when
      const result = AgentOverrideConfigSchema.safeParse(config)

      // then
      expect(result.success).toBe(false)
    })
  })

  describe("skills field", () => {
    test("accepts skills as optional string array", () => {
      // given
      const config = { skills: ["frontend-ui-ux", "code-reviewer"] }

      // when
      const result = AgentOverrideConfigSchema.safeParse(config)

      // then
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.skills).toEqual(["frontend-ui-ux", "code-reviewer"])
      }
    })

    test("accepts empty skills array", () => {
      // given
      const config = { skills: [] }

      // when
      const result = AgentOverrideConfigSchema.safeParse(config)

      // then
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.skills).toEqual([])
      }
    })

    test("accepts config without skills", () => {
      // given
      const config = { temperature: 0.5 }

      // when
      const result = AgentOverrideConfigSchema.safeParse(config)

      // then
      expect(result.success).toBe(true)
    })

    test("rejects non-array skills", () => {
      // given
      const config = { skills: "frontend-ui-ux" }

      // when
      const result = AgentOverrideConfigSchema.safeParse(config)

      // then
      expect(result.success).toBe(false)
    })
  })

  describe("backward compatibility", () => {
    test("still accepts model field (deprecated)", () => {
      // given
      const config = { model: "openai/gpt-5.2" }

      // when
      const result = AgentOverrideConfigSchema.safeParse(config)

      // then
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.model).toBe("openai/gpt-5.2")
      }
    })

    test("accepts both model and category (deprecated usage)", () => {
      // given - category should take precedence at runtime, but both should validate
      const config = { 
        model: "openai/gpt-5.2",
        category: "ultrabrain"
      }

      // when
      const result = AgentOverrideConfigSchema.safeParse(config)

      // then
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.model).toBe("openai/gpt-5.2")
        expect(result.data.category).toBe("ultrabrain")
      }
    })
  })

  describe("combined fields", () => {
    test("accepts category with skills", () => {
      // given
      const config = { 
        category: "visual-engineering",
        skills: ["frontend-ui-ux"]
      }

      // when
      const result = AgentOverrideConfigSchema.safeParse(config)

      // then
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.category).toBe("visual-engineering")
        expect(result.data.skills).toEqual(["frontend-ui-ux"])
      }
    })

    test("accepts category with skills and other fields", () => {
      // given
      const config = { 
        category: "ultrabrain",
        skills: ["code-reviewer"],
        temperature: 0.3,
        prompt_append: "Extra instructions"
      }

      // when
      const result = AgentOverrideConfigSchema.safeParse(config)

      // then
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.category).toBe("ultrabrain")
        expect(result.data.skills).toEqual(["code-reviewer"])
        expect(result.data.temperature).toBe(0.3)
        expect(result.data.prompt_append).toBe("Extra instructions")
      }
    })
  })
})

describe("CategoryConfigSchema", () => {
  test("accepts variant as optional string", () => {
    // given
    const config = { model: "openai/gpt-5.2", variant: "xhigh" }

    // when
    const result = CategoryConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.variant).toBe("xhigh")
    }
  })

  test("accepts reasoningEffort as optional string with xhigh", () => {
    // given
    const config = { reasoningEffort: "xhigh" }

    // when
    const result = CategoryConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.reasoningEffort).toBe("xhigh")
    }
  })

  test("rejects non-string variant", () => {
    // given
    const config = { model: "openai/gpt-5.2", variant: 123 }

    // when
    const result = CategoryConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(false)
  })
})

describe("BuiltinCategoryNameSchema", () => {
  test("accepts all builtin category names", () => {
    // given
    const categories = ["visual-engineering", "ultrabrain", "artistry", "quick", "unspecified-low", "unspecified-high", "writing"]

    // when / #then
    for (const cat of categories) {
      const result = BuiltinCategoryNameSchema.safeParse(cat)
      expect(result.success).toBe(true)
    }
  })
})

describe("Sisyphus-Junior agent override", () => {
  test("schema accepts agents['Sisyphus-Junior'] and retains the key after parsing", () => {
    // given
    const config = {
      agents: {
        "sisyphus-junior": {
          model: "openai/gpt-5.2",
          temperature: 0.2,
        },
      },
    }

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.agents?.["sisyphus-junior"]).toBeDefined()
      expect(result.data.agents?.["sisyphus-junior"]?.model).toBe("openai/gpt-5.2")
      expect(result.data.agents?.["sisyphus-junior"]?.temperature).toBe(0.2)
    }
  })

  test("schema accepts sisyphus-junior with prompt_append", () => {
    // given
    const config = {
      agents: {
        "sisyphus-junior": {
          prompt_append: "Additional instructions for sisyphus-junior",
        },
      },
    }

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.agents?.["sisyphus-junior"]?.prompt_append).toBe(
        "Additional instructions for sisyphus-junior"
      )
    }
  })

  test("schema accepts sisyphus-junior with tools override", () => {
    // given
    const config = {
      agents: {
        "sisyphus-junior": {
          tools: {
            read: true,
            write: false,
          },
        },
      },
    }

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.agents?.["sisyphus-junior"]?.tools).toEqual({
        read: true,
        write: false,
      })
    }
  })

  test("schema accepts lowercase agent names (sisyphus, solver, verifier)", () => {
    // given
    const config = {
      agents: {
        sisyphus: {
          temperature: 0.1,
        },
        solver: {
          temperature: 0.2,
        },
        verifier: {
          temperature: 0.3,
        },
      },
    }

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.agents?.sisyphus?.temperature).toBe(0.1)
      expect(result.data.agents?.solver?.temperature).toBe(0.2)
      expect(result.data.agents?.verifier?.temperature).toBe(0.3)
    }
  })

  test("schema accepts lowercase reference-reviewer and coach agent names", () => {
    // given
    const config = {
      agents: {
        "reference-reviewer": {
          category: "ultrabrain",
        },
        coach: {
          category: "quick",
        },
      },
    }

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.agents?.["reference-reviewer"]?.category).toBe("ultrabrain")
      expect(result.data.agents?.coach?.category).toBe("quick")
    }
  })
})

describe("OpenMath markdown-mode agent overrides", () => {
  const markdownModeAgentKeys = [
    "solver-markdown",
    "solver-markdown-patch",
    "reference-reviewer-markdown",
    "reference-reviewer-patch",
  ] as const

  test("schema accepts and preserves all markdown-mode OpenMath agent overrides", () => {
    // given
    const config = {
      agents: {
        "solver-markdown": {
          model: "openai/gpt-5.4",
          variant: "high",
          category: "unspecified-high",
          temperature: 0.2,
        },
        "solver-markdown-patch": {
          model: "openai/gpt-5.4-mini",
          variant: "medium",
          category: "quick",
          temperature: 0.1,
        },
        "reference-reviewer-markdown": {
          model: "anthropic/claude-sonnet-4-6",
          variant: "max",
          category: "ultrabrain",
          temperature: 0.3,
        },
        "reference-reviewer-patch": {
          model: "google/gemini-3-pro",
          variant: "high",
          category: "deep",
          temperature: 0.25,
        },
      },
    }

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(true)
    if (result.success) {
      for (const key of markdownModeAgentKeys) {
        expect(result.data.agents?.[key]).toBeDefined()
      }

      expect(result.data.agents?.["solver-markdown"]?.model).toBe("openai/gpt-5.4")
      expect(result.data.agents?.["solver-markdown"]?.variant).toBe("high")
      expect(result.data.agents?.["solver-markdown"]?.category).toBe("unspecified-high")
      expect(result.data.agents?.["solver-markdown"]?.temperature).toBe(0.2)

      expect(result.data.agents?.["solver-markdown-patch"]?.model).toBe("openai/gpt-5.4-mini")
      expect(result.data.agents?.["solver-markdown-patch"]?.variant).toBe("medium")
      expect(result.data.agents?.["solver-markdown-patch"]?.category).toBe("quick")
      expect(result.data.agents?.["solver-markdown-patch"]?.temperature).toBe(0.1)

      expect(result.data.agents?.["reference-reviewer-markdown"]?.model).toBe("anthropic/claude-sonnet-4-6")
      expect(result.data.agents?.["reference-reviewer-markdown"]?.variant).toBe("max")
      expect(result.data.agents?.["reference-reviewer-markdown"]?.category).toBe("ultrabrain")
      expect(result.data.agents?.["reference-reviewer-markdown"]?.temperature).toBe(0.3)

      expect(result.data.agents?.["reference-reviewer-patch"]?.model).toBe("google/gemini-3-pro")
      expect(result.data.agents?.["reference-reviewer-patch"]?.variant).toBe("high")
      expect(result.data.agents?.["reference-reviewer-patch"]?.category).toBe("deep")
      expect(result.data.agents?.["reference-reviewer-patch"]?.temperature).toBe(0.25)
    }
  })

  test("agent override schema and overridable-name schema stay aligned for markdown-mode OpenMath keys", () => {
    // given
    const expectedKeys = [...markdownModeAgentKeys].sort()

    // when
    const overrideSchemaMarkdownKeys = Object.keys(AgentOverridesSchema.shape)
      .filter((name) => name.includes("-markdown") || name === "reference-reviewer-patch")
      .sort()

    const overridableNameSchemaMarkdownKeys = OverridableAgentNameSchema.options
      .filter((name) => name.includes("-markdown") || name === "reference-reviewer-patch")
      .sort()

    // then
    expect(overrideSchemaMarkdownKeys).toEqual(expectedKeys)
    expect(overridableNameSchemaMarkdownKeys).toEqual(expectedKeys)
  })
})

describe("BrowserAutomationProviderSchema", () => {
  test("accepts 'playwright' as valid provider", () => {
    // given
    const input = "playwright"

    // when
    const result = BrowserAutomationProviderSchema.safeParse(input)

    // then
    expect(result.success).toBe(true)
    expect(result.data).toBe("playwright")
  })

  test("accepts 'agent-browser' as valid provider", () => {
    // given
    const input = "agent-browser"

    // when
    const result = BrowserAutomationProviderSchema.safeParse(input)

    // then
    expect(result.success).toBe(true)
    expect(result.data).toBe("agent-browser")
  })

  test("rejects invalid provider", () => {
    // given
    const input = "invalid-provider"

    // when
    const result = BrowserAutomationProviderSchema.safeParse(input)

    // then
    expect(result.success).toBe(false)
  })

  test("accepts 'playwright-cli' as valid provider", () => {
    // given
    const input = "playwright-cli"

    // when
    const result = BrowserAutomationProviderSchema.safeParse(input)

    // then
    expect(result.success).toBe(true)
    expect(result.data).toBe("playwright-cli")
  })
})

describe("BrowserAutomationConfigSchema", () => {
  test("defaults provider to 'playwright' when not specified", () => {
    // given
    const input = {}

    // when
    const result = BrowserAutomationConfigSchema.parse(input)

    // then
    expect(result.provider).toBe("playwright")
  })

  test("accepts agent-browser provider", () => {
    // given
    const input = { provider: "agent-browser" }

    // when
    const result = BrowserAutomationConfigSchema.parse(input)

    // then
    expect(result.provider).toBe("agent-browser")
  })

  test("accepts playwright-cli provider in config", () => {
    // given
    const input = { provider: "playwright-cli" }

    // when
    const result = BrowserAutomationConfigSchema.parse(input)

    // then
    expect(result.provider).toBe("playwright-cli")
  })
})

describe("OhMyOpenCodeConfigSchema - browser_automation_engine", () => {
  test("accepts browser_automation_engine config", () => {
    // given
    const input = {
      browser_automation_engine: {
        provider: "agent-browser",
      },
    }

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(input)

    // then
    expect(result.success).toBe(true)
    expect(result.data?.browser_automation_engine?.provider).toBe("agent-browser")
  })

  test("accepts config without browser_automation_engine", () => {
    // given
    const input = {}

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(input)

    // then
    expect(result.success).toBe(true)
    expect(result.data?.browser_automation_engine).toBeUndefined()
  })

  test("accepts browser_automation_engine with playwright-cli", () => {
    // given
    const input = { browser_automation_engine: { provider: "playwright-cli" } }

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(input)

    // then
    expect(result.success).toBe(true)
    expect(result.data?.browser_automation_engine?.provider).toBe("playwright-cli")
  })
})

describe("ExperimentalConfigSchema feature flags", () => {
  test("accepts plugin_load_timeout_ms as number", () => {
    //#given
    const config = { plugin_load_timeout_ms: 5000 }

    //#when
    const result = ExperimentalConfigSchema.safeParse(config)

    //#then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.plugin_load_timeout_ms).toBe(5000)
    }
  })

  test("rejects plugin_load_timeout_ms below 1000", () => {
    //#given
    const config = { plugin_load_timeout_ms: 500 }

    //#when
    const result = ExperimentalConfigSchema.safeParse(config)

    //#then
    expect(result.success).toBe(false)
  })

  test("accepts safe_hook_creation as boolean", () => {
    //#given
    const config = { safe_hook_creation: false }

    //#when
    const result = ExperimentalConfigSchema.safeParse(config)

    //#then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.safe_hook_creation).toBe(false)
    }
  })

  test("both fields are optional", () => {
    //#given
    const config = {}

    //#when
    const result = ExperimentalConfigSchema.safeParse(config)

    //#then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.plugin_load_timeout_ms).toBeUndefined()
      expect(result.data.safe_hook_creation).toBeUndefined()
    }
  })

  test("accepts hashline_edit as true", () => {
    //#given
    const config = { hashline_edit: true }

    //#when
    const result = ExperimentalConfigSchema.safeParse(config)

    //#then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.hashline_edit).toBe(true)
    }
  })

  test("accepts hashline_edit as false", () => {
    //#given
    const config = { hashline_edit: false }

    //#when
    const result = ExperimentalConfigSchema.safeParse(config)

    //#then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.hashline_edit).toBe(false)
    }
  })

  test("hashline_edit is optional", () => {
    //#given
    const config = { safe_hook_creation: true }

    //#when
    const result = ExperimentalConfigSchema.safeParse(config)

    //#then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.hashline_edit).toBeUndefined()
    }
  })

  test("rejects non-boolean hashline_edit", () => {
    //#given
    const config = { hashline_edit: "true" }

    //#when
    const result = ExperimentalConfigSchema.safeParse(config)

    //#then
    expect(result.success).toBe(false)
  })
})

describe("GitMasterConfigSchema", () => {
  test("accepts boolean true for commit_footer", () => {
    //#given
    const config = { commit_footer: true }

    //#when
    const result = GitMasterConfigSchema.safeParse(config)

    //#then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.commit_footer).toBe(true)
    }
  })

  test("accepts boolean false for commit_footer", () => {
    //#given
    const config = { commit_footer: false }

    //#when
    const result = GitMasterConfigSchema.safeParse(config)

    //#then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.commit_footer).toBe(false)
    }
  })

  test("accepts string value for commit_footer", () => {
    //#given
    const config = { commit_footer: "Custom footer text" }

    //#when
    const result = GitMasterConfigSchema.safeParse(config)

    //#then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.commit_footer).toBe("Custom footer text")
    }
  })

  test("defaults commit_footer to true when not provided", () => {
    //#given
    const config = {}

    //#when
    const result = GitMasterConfigSchema.safeParse(config)

    //#then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.commit_footer).toBe(true)
    }
  })

  test("rejects number for commit_footer", () => {
    //#given
    const config = { commit_footer: 123 }

    //#when
    const result = GitMasterConfigSchema.safeParse(config)

    //#then
    expect(result.success).toBe(false)
  })
})

describe("skills schema", () => {
  test("accepts skills.sources configuration", () => {
    //#given
    const config = {
      skills: {
        sources: [{ path: "skill/", recursive: true }],
      },
    }

    //#when
    const result = OhMyOpenCodeConfigSchema.safeParse(config)

    //#then
    expect(result.success).toBe(true)
  })
})

describe("OpenMathConfigSchema", () => {
  test("defaults max_review_rounds to 3", () => {
    // given
    const input = {}

    // when
    const result = OpenMathConfigSchema.parse(input)

    // then
    expect(result.max_review_rounds).toBe(3)
  })

  test("defaults max_consecutive_patch_failures to 2", () => {
    // given
    const input = {}

    // when
    const result = OpenMathConfigSchema.parse(input)

    // then
    expect(result.max_consecutive_patch_failures).toBe(2)
  })

  test("defaults artifacts.format to 'markdown'", () => {
    // given
    const input = {}

    // when
    const result = OpenMathConfigSchema.parse(input)

    // then
    expect(result.artifacts.format).toBe("markdown")
  })

  test("rejects max_review_rounds below 1", () => {
    // given
    const input = { max_review_rounds: 0 }

    // when
    const result = OpenMathConfigSchema.safeParse(input)

    // then
    expect(result.success).toBe(false)
  })

  test("rejects max_consecutive_patch_failures below 1", () => {
    // given
    const input = { max_consecutive_patch_failures: 0 }

    // when
    const result = OpenMathConfigSchema.safeParse(input)

    // then
    expect(result.success).toBe(false)
  })

  test("accepts max_review_rounds above 20", () => {
    // given
    const input = { max_review_rounds: 21 }

    // when
    const result = OpenMathConfigSchema.safeParse(input)

    // then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.max_review_rounds).toBe(21)
    }
  })

  test("accepts max_concurrency above 20 in solve_only", () => {
    // given
    const input = { solve_only: { max_concurrency: 25 } }

    // when
    const result = OpenMathConfigSchema.safeParse(input)

    // then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.solve_only?.max_concurrency).toBe(25)
    }
  })

  test("rejects max_concurrency below 1 in solve_only", () => {
    // given
    const input = { solve_only: { max_concurrency: 0 } }

    // when
    const result = OpenMathConfigSchema.safeParse(input)

    // then
    expect(result.success).toBe(false)
  })

  test("accepts artifacts.format='json'", () => {
    // given
    const input = { artifacts: { format: "json" } }

    // when
    const result = OpenMathConfigSchema.parse(input)

    // then
    expect(result.artifacts.format).toBe("json")
  })

  test("defaults state_filename_mode to 'linux'", () => {
    // given
    const input = {}

    // when
    const result = OpenMathConfigSchema.parse(input)

    // then
    expect(result.state_filename_mode).toBe("linux")
  })

  test("accepts state_filename_mode='windows'", () => {
    // given
    const input = { state_filename_mode: "windows" }

    // when
    const result = OpenMathConfigSchema.parse(input)

    // then
    expect(result.state_filename_mode).toBe("windows")
  })
})

describe("LocalizationConfigSchema", () => {
  test("accepts response_language='auto'", () => {
    // given
    const input = { response_language: "auto" }

    // when
    const result = LocalizationConfigSchema.safeParse(input)

    // then
    expect(result.success).toBe(true)
  })

  test("accepts safe language tags", () => {
    // given
    const inputs = ["en", "en-US", "zh-Hans", "ko-KR"]

    for (const tag of inputs) {
      // when
      const result = LocalizationConfigSchema.safeParse({ response_language: tag })

      // then
      expect(result.success).toBe(true)
    }
  })

  test("rejects whitespace in response_language", () => {
    // given
    const input = { response_language: "en US" }

    // when
    const result = LocalizationConfigSchema.safeParse(input)

    // then
    expect(result.success).toBe(false)
  })

  test("rejects newlines in response_language", () => {
    // given
    const input = { response_language: "en\nUS" }

    // when
    const result = LocalizationConfigSchema.safeParse(input)

    // then
    expect(result.success).toBe(false)
  })
})

describe("PerformanceConfigSchema", () => {
  test("enforces delegate_task_timing conservative minimums", () => {
    // given
    const bad = { delegate_task_timing: { POLL_INTERVAL_MS: 100, MIN_STABILITY_TIME_MS: 500 } }
    const good = { delegate_task_timing: { POLL_INTERVAL_MS: 250, MIN_STABILITY_TIME_MS: 1000 } }

    // when
    const badResult = PerformanceConfigSchema.safeParse(bad)
    const goodResult = PerformanceConfigSchema.safeParse(good)

    // then
    expect(badResult.success).toBe(false)
    expect(goodResult.success).toBe(true)
  })

  test("enforces background_agent_polling conservative minimums", () => {
    // given
    const bad = {
      background_agent_polling: {
        pollingIntervalMs: 100,
        minStabilityTimeMs: 500,
        minIdleTimeMs: 100,
      },
    }
    const good = {
      background_agent_polling: {
        pollingIntervalMs: 250,
        minStabilityTimeMs: 1000,
        minIdleTimeMs: 250,
      },
    }

    // when
    const badResult = PerformanceConfigSchema.safeParse(bad)
    const goodResult = PerformanceConfigSchema.safeParse(good)

    // then
    expect(badResult.success).toBe(false)
    expect(goodResult.success).toBe(true)
  })
})

describe("OhMyOpenCodeConfigSchema - openmath/localization/performance", () => {
  test("accepts the new sections and applies nested defaults when provided", () => {
    // given
    const input = {
      openmath: {},
      localization: { response_language: "en-US" },
      performance: {
        delegate_task_timing: {
          POLL_INTERVAL_MS: 250,
          MIN_STABILITY_TIME_MS: 1000,
        },
      },
    }

    // when
    const result = OhMyOpenCodeConfigSchema.parse(input)

    // then
    expect(result.openmath?.max_review_rounds).toBe(3)
    expect(result.openmath?.artifacts.format).toBe("markdown")
    expect(result.localization?.response_language).toBe("en-US")
    expect(result.performance?.delegate_task_timing?.POLL_INTERVAL_MS).toBe(250)
  })
})
