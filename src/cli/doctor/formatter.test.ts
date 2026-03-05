import { describe, expect, it } from "bun:test"
import type { DoctorResult } from "./types"
import { stripAnsi } from "./format-shared"
import { formatDoctorOutput, formatJsonOutput } from "./formatter"

function createDoctorResult(): DoctorResult {
  return {
    results: [
      { name: "System", status: "pass", message: "ok", issues: [] },
      { name: "Configuration", status: "warn", message: "warn", issues: [] },
    ],
    systemInfo: {
      opencodeVersion: "1.0.200",
      opencodePath: "/usr/local/bin/opencode",
      pluginVersion: "3.4.0",
      loadedVersion: "3.4.0",
      bunVersion: "1.2.0",
      configPath: "/tmp/opencode.jsonc",
      configValid: true,
      isLocalDev: false,
    },
    tools: {
      lspInstalled: 2,
      lspTotal: 4,
      astGrepCli: true,
      astGrepNapi: false,
      commentChecker: true,
      ghCli: { installed: true, authenticated: true, username: "yeongyu" },
      mcpBuiltin: ["context7", "grep_app"],
      mcpUser: ["custom"],
    },
    summary: {
      total: 2,
      passed: 1,
      failed: 0,
      warnings: 1,
      skipped: 0,
      duration: 12,
    },
    exitCode: 0,
  }
}

describe("formatter", () => {
  describe("formatDoctorOutput", () => {
    it("renders output for default mode", () => {
      //#given
      const result = createDoctorResult()

      //#when
      const output = stripAnsi(formatDoctorOutput(result, "default"))

      //#then
      expect(output).toContain("System OK")
    })

    it("renders output for status mode", () => {
      //#given
      const result = createDoctorResult()

      //#when
      const output = stripAnsi(formatDoctorOutput(result, "status"))

      //#then
      expect(output).toContain("System")
      expect(output).toContain("Config")
      expect(output).toContain("MCPs")
    })

    it("renders output for verbose mode", () => {
      //#given
      const result = createDoctorResult()

      //#when
      const output = stripAnsi(formatDoctorOutput(result, "verbose"))

      //#then
      expect(output).toContain("System Information")
      expect(output).toContain("Summary")
    })
  })

  describe("formatJsonOutput", () => {
    it("returns valid JSON payload", () => {
      //#given
      const result = createDoctorResult()

      //#when
      const output = formatJsonOutput(result)
      const parsed = JSON.parse(output) as DoctorResult

      //#then
      expect(parsed.summary.total).toBe(2)
      expect(parsed.systemInfo.pluginVersion).toBe("3.4.0")
      expect(parsed.tools.ghCli.username).toBe("yeongyu")
      expect(parsed.exitCode).toBe(0)
    })
  })
})
