import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mergeConfigs, parseConfigPartially } from "./plugin-config";
import { loadConfigFromPath } from "./plugin-config";
import { applyOpenMathOnlyDefaults } from "./config/openmath-only-defaults";
import { warnUnsupportedAgentKeys } from "./config/unsupported-agent-keys";
import { HookNameSchema } from "./config";
import type { OhMyOpenCodeConfig } from "./config";
import { clearConfigLoadErrors, getConfigLoadErrors } from "./shared";

describe("mergeConfigs", () => {
  describe("categories merging", () => {
    // given base config has categories, override has different categories
    // when merging configs
    // then should deep merge categories, not override completely

    it("should deep merge categories from base and override", () => {
      const base = {
        categories: {
          general: {
            model: "openai/gpt-5.2",
            temperature: 0.5,
          },
          quick: {
            model: "anthropic/claude-haiku-4-5",
          },
        },
      } as OhMyOpenCodeConfig;

      const override = {
        categories: {
          general: {
            temperature: 0.3,
          },
          visual: {
            model: "google/gemini-3-pro",
          },
        },
      } as unknown as OhMyOpenCodeConfig;

      const result = mergeConfigs(base, override);

      // then general.model should be preserved from base
      expect(result.categories?.general?.model).toBe("openai/gpt-5.2");
      // then general.temperature should be overridden
      expect(result.categories?.general?.temperature).toBe(0.3);
      // then quick should be preserved from base
      expect(result.categories?.quick?.model).toBe("anthropic/claude-haiku-4-5");
      // then visual should be added from override
      expect(result.categories?.visual?.model).toBe("google/gemini-3-pro");
    });

    it("should preserve base categories when override has no categories", () => {
      const base: OhMyOpenCodeConfig = {
        categories: {
          general: {
            model: "openai/gpt-5.2",
          },
        },
      };

      const override: OhMyOpenCodeConfig = {};

      const result = mergeConfigs(base, override);

      expect(result.categories?.general?.model).toBe("openai/gpt-5.2");
    });

    it("should use override categories when base has no categories", () => {
      const base: OhMyOpenCodeConfig = {};

      const override: OhMyOpenCodeConfig = {
        categories: {
          general: {
            model: "openai/gpt-5.2",
          },
        },
      };

      const result = mergeConfigs(base, override);

      expect(result.categories?.general?.model).toBe("openai/gpt-5.2");
    });
  });

  describe("existing behavior preservation", () => {
    it("should deep merge agents", () => {
      const base: OhMyOpenCodeConfig = {
        agents: {
          solver: { model: "openai/gpt-5.2" },
        },
      };

      const override: OhMyOpenCodeConfig = {
        agents: {
          solver: { temperature: 0.5 },
          verifier: { model: "anthropic/claude-haiku-4-5" },
        },
      };

      const result = mergeConfigs(base, override);

      expect(result.agents?.solver?.model).toBe("openai/gpt-5.2");
      expect(result.agents?.solver?.temperature).toBe(0.5);
      expect(result.agents?.verifier?.model).toBe("anthropic/claude-haiku-4-5");
    });

    it("should merge disabled arrays without duplicates", () => {
      const base: OhMyOpenCodeConfig = {
        disabled_hooks: ["comment-checker", "think-mode"],
      };

      const override: OhMyOpenCodeConfig = {
        disabled_hooks: ["think-mode", "session-recovery"],
      };

      const result = mergeConfigs(base, override);

      expect(result.disabled_hooks).toContain("comment-checker");
      expect(result.disabled_hooks).toContain("think-mode");
      expect(result.disabled_hooks).toContain("session-recovery");
      expect(result.disabled_hooks?.length).toBe(3);
    });
  });
});

describe("parseConfigPartially", () => {
  describe("fully valid config", () => {
    //#given a config where all sections are valid
    //#when parsing the config
    //#then should return the full parsed config unchanged

    it("should return the full config when everything is valid", () => {
      const rawConfig = {
        agents: {
          solver: { model: "openai/gpt-5.2" },
          verifier: { model: "openai/gpt-5.2" },
        },
        disabled_hooks: ["comment-checker"],
      };

      const result = parseConfigPartially(rawConfig);

      expect(result).not.toBeNull();
      expect(result!.agents?.solver?.model).toBe("openai/gpt-5.2");
      expect(result!.agents?.verifier?.model).toBe("openai/gpt-5.2");
      expect(result!.disabled_hooks).toEqual(["comment-checker"]);
    });

    it("preserves markdown-mode OpenMath agent overrides unchanged", () => {
      const rawConfig = {
        agents: {
          "solver-markdown": { model: "openai/gpt-5.4", variant: "high", category: "unspecified-high" },
          "solver-markdown-patch": { model: "openai/gpt-5.4-mini", variant: "medium", category: "quick" },
          "reference-reviewer-markdown": { model: "anthropic/claude-opus-4-6", variant: "max" },
          "reference-reviewer-patch": { model: "google/gemini-3-pro", variant: "high" },
        },
      };

      const result = parseConfigPartially(rawConfig);

      expect(result).not.toBeNull();
      expect(result!.agents?.["solver-markdown"]?.model).toBe("openai/gpt-5.4");
      expect(result!.agents?.["solver-markdown-patch"]?.model).toBe("openai/gpt-5.4-mini");
      expect(result!.agents?.["reference-reviewer-markdown"]?.model).toBe("anthropic/claude-opus-4-6");
      expect(result!.agents?.["reference-reviewer-patch"]?.model).toBe("google/gemini-3-pro");
    });
  });

  describe("partially invalid config", () => {
    //#given a config where one section is invalid but others are valid
    //#when parsing the config
    //#then should return valid sections and skip invalid ones

    it("should preserve valid agent overrides when another section is invalid", () => {
      const rawConfig = {
        agents: {
          solver: { model: "openai/gpt-5.2" },
          verifier: { model: "openai/gpt-5.2" },
          prometheus: {
            permission: {
              edit: { "*": "ask", ".sisyphus/**": "allow" },
            },
          },
        },
        disabled_hooks: ["comment-checker"],
      };

      const result = parseConfigPartially(rawConfig);

      expect(result).not.toBeNull();
      expect(result!.disabled_hooks).toEqual(["comment-checker"]);
      expect(result!.agents).toBeUndefined();
    });

    it("should preserve valid agents when a non-agent section is invalid", () => {
      const rawConfig = {
        agents: {
          solver: { model: "openai/gpt-5.2" },
        },
        disabled_hooks: ["not-a-real-hook"],
      };

      const result = parseConfigPartially(rawConfig);

      expect(result).not.toBeNull();
      expect(result!.agents?.solver?.model).toBe("openai/gpt-5.2");
      expect(result!.disabled_hooks).toBeUndefined();
    });
  });

  describe("completely invalid config", () => {
    //#given a config where all sections are invalid
    //#when parsing the config
    //#then should return an empty object (not null)

    it("should return empty object when all sections are invalid", () => {
      const rawConfig = {
        agents: { solver: { temperature: "not-a-number" } },
        disabled_hooks: ["not-a-real-hook"],
      };

      const result = parseConfigPartially(rawConfig);

      expect(result).not.toBeNull();
      expect(result!.agents).toBeUndefined();
      expect(result!.disabled_hooks).toBeUndefined();
    });
  });

  describe("empty config", () => {
    //#given an empty config object
    //#when parsing the config
    //#then should return an empty object (fast path - full parse succeeds)

    it("should return empty object for empty input", () => {
      const result = parseConfigPartially({});

      expect(result).not.toBeNull();
      expect(Object.keys(result!).length).toBe(0);
    });
  });

  describe("unknown keys", () => {
    //#given a config with keys not in the schema
    //#when parsing the config
    //#then should silently ignore unknown keys and preserve valid ones

    it("should ignore unknown keys and return valid sections", () => {
      const rawConfig = {
        agents: {
          solver: { model: "openai/gpt-5.2" },
        },
        some_future_key: { foo: "bar" },
      };

      const result = parseConfigPartially(rawConfig);

      expect(result).not.toBeNull();
      expect(result!.agents?.solver?.model).toBe("openai/gpt-5.2");
      expect((result as Record<string, unknown>)["some_future_key"]).toBeUndefined();
    });
  });
});

describe("applyOpenMathOnlyDefaults", () => {
  it("applies OpenMath-only disabled defaults for empty config", () => {
    const result = applyOpenMathOnlyDefaults({});
    const enabledByOmission = new Set(["background-notification"]);

    expect(result.disabled_agents).toBeDefined();
    expect(result.disabled_agents).toEqual([]);
    expect(result.disabled_agents).not.toContain("sisyphus");

    expect(result.disabled_tools).toBeDefined();
    expect(result.disabled_tools).toContain("call_omo_agent");
    expect(result.disabled_tools).toContain("lsp_goto_definition");
    expect(result.disabled_tools).toContain("slashcommand");
    expect(result.disabled_tools).not.toContain("task");
    expect(result.disabled_tools).not.toContain("background_output");
    // OpenMath state tools should be enabled by default
    expect(result.disabled_tools).not.toContain("openmath_state_get");
    expect(result.disabled_tools).not.toContain("openmath_state_set");
    expect(result.disabled_tools).not.toContain("openmath_state_reset");

    expect(result.disabled_hooks).toBeDefined();
    expect(result.disabled_hooks).toContain("todo-continuation-enforcer");
    expect(result.disabled_hooks).toContain("session-recovery");
    expect(result.disabled_hooks).toContain("comment-checker");
    expect(result.disabled_hooks).toContain("rules-injector");
    expect(result.disabled_hooks).toContain("think-mode");
    expect(result.disabled_hooks).toContain("auto-slash-command");
    expect(result.disabled_hooks).toContain("atlas");
    expect(result.disabled_hooks).not.toContain("background-notification");

    for (const hookName of HookNameSchema.options) {
      if (enabledByOmission.has(hookName)) {
        expect(result.disabled_hooks).not.toContain(hookName);
      } else {
        expect(result.disabled_hooks).toContain(hookName);
      }
    }

    expect(result.disabled_hooks?.length).toBe(HookNameSchema.options.length - enabledByOmission.size);
  });

  it("preserves existing disabled list entries while composing defaults", () => {
    const config: OhMyOpenCodeConfig = {
      disabled_agents: ["solver"],
      disabled_tools: ["task"],
      disabled_hooks: ["background-notification"],
    };

    const result = applyOpenMathOnlyDefaults(config);

    expect(result.disabled_agents).toContain("solver");
    expect(result.disabled_tools).toContain("task");
    expect(result.disabled_hooks).toContain("background-notification");
    expect(result.disabled_agents).not.toContain("oracle");
    expect(result.disabled_tools).toContain("call_omo_agent");
    expect(result.disabled_hooks).toContain("think-mode");
  });
});

describe("warnUnsupportedAgentKeys", () => {
  describe("valid agent keys", () => {
    it("returns no warnings for valid agent keys", () => {
      const rawAgents = {
        solver: { model: "openai/gpt-5.2" },
        verifier: { model: "anthropic/claude-haiku-4-5" },
        prometheus: { category: "orchestrator" },
        "sisyphus-junior": { model: "gpt-4o" },
        "solver-markdown": { model: "openai/gpt-5.2" },
        "solver-markdown-patch": { model: "openai/gpt-5.2" },
        "reference-reviewer-markdown": { model: "anthropic/claude-opus-4-6" },
        "reference-reviewer-patch": { model: "anthropic/claude-opus-4-6" },
      };

      const warnings = warnUnsupportedAgentKeys(rawAgents, "test");
      expect(warnings).toEqual([]);
    });

    it("returns casing warnings for case-mismatched keys", () => {
      const rawAgents = {
        SOLVER: { model: "openai/gpt-5.2" },
        Verifier: { model: "anthropic/claude-haiku-4-5" },
        "Sisyphus-Junior": { model: "gpt-4o" },
      };

      const warnings = warnUnsupportedAgentKeys(rawAgents, "test");
      expect(warnings).toHaveLength(3);
      expect(warnings[0]).toContain("incorrect casing");
      expect(warnings.join("\n")).toContain("Use \"solver\"");
    });
  });

  describe("invalid agent keys", () => {
    it("returns warnings naming typo agent keys", () => {
      const rawAgents = {
        "solver-markdownx": { model: "openai/gpt-5.2" },
        solve: { model: "openai/gpt-5.2" },
      };

      const warnings = warnUnsupportedAgentKeys(rawAgents, "project");
      expect(warnings).toHaveLength(2);
      expect(warnings.join("\n")).toContain("solver-markdownx");
      expect(warnings.join("\n")).toContain("solve");
    });

    it("should handle undefined agents", () => {
      expect(warnUnsupportedAgentKeys(undefined, "project")).toEqual([]);
    });

    it("should handle empty agents object", () => {
      expect(warnUnsupportedAgentKeys({}, "user")).toEqual([]);
    });

    it("returns warnings for completely unknown agent keys", () => {
      const rawAgents = {
        unknownAgent: { model: "gpt-4" },
        myCustomAgent: { temperature: 0.5 },
      };

      const warnings = warnUnsupportedAgentKeys(rawAgents, "user");
      expect(warnings).toHaveLength(2);
      expect(warnings.join("\n")).toContain("unknownAgent");
      expect(warnings.join("\n")).toContain("myCustomAgent");
    });
  });
});

describe("loadConfigFromPath unsupported-agent warnings", () => {
  it("keeps valid agent overrides and does not raise config load errors for typo keys", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "oh-my-opencode-config-warning-test-"));
    const configPath = join(tempDir, "oh-my-opencode.json");

    try {
      writeFileSync(
        configPath,
        JSON.stringify({
          agents: {
            "solver-markdown": { model: "openai/gpt-5.4" },
            "solver-markdownx": { model: "openai/gpt-5.4" },
          },
        }),
        "utf-8",
      );

      clearConfigLoadErrors();
      const result = loadConfigFromPath(configPath, {});
      const errors = getConfigLoadErrors();

      expect(result).not.toBeNull();
      expect(result!.agents?.["solver-markdown"]?.model).toBe("openai/gpt-5.4");
      expect((result!.agents as Record<string, unknown>)["solver-markdownx"]).toBeUndefined();
      expect(errors).toEqual([]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
