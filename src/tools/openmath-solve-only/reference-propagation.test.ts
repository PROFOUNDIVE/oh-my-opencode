import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

import type { ToolContext } from "@opencode-ai/plugin/tool"
import { createLegacyReferenceSnapshot } from "../../openmath/references/snapshot"
import { renderReferenceBundle } from "../../openmath/references/renderer"
import {
  CHARACTERIZATION_REFS,
  createCharacterizationArtifacts,
  createReviewResult,
  parseDispatchedPayload,
  type DispatchedSubagentCall,
  type SubagentResult,
} from "./workflow-characterization-fixtures"

let dispatchSubagent: (call: DispatchedSubagentCall) => Promise<SubagentResult>

mock.module("./run-sync-subagent", () => ({
  runSyncSubagentText: (call: DispatchedSubagentCall) => dispatchSubagent(call),
}))

import { createOpenMathSolveOnlyTool } from "./tools"

const context = {
  sessionID: "parent-session",
  messageID: "message",
  agent: "test-agent",
  abort: new AbortController().signal,
  metadata: () => {},
  ask: async () => {},
} satisfies ToolContext

type ReferenceBundle = ReturnType<typeof renderReferenceBundle>

function supplementaryBundle(payload: Record<string, unknown>, stage: "solve" | "review" | "revise"): ReferenceBundle | null {
  const direct = payload.supplementary_refs
  if (Array.isArray(direct) && direct.every((value) => typeof value === "string")) {
    return renderReferenceBundle(createLegacyReferenceSnapshot(direct), stage)
  }
  const bundle = payload.reference_bundle
  if (!bundle || typeof bundle !== "object" || Array.isArray(bundle)) return null
  const candidate = bundle as Record<string, unknown>
  if (candidate.stage !== stage || typeof candidate.sha256 !== "string" || typeof candidate.content !== "string") return null
  return { stage, sha256: candidate.sha256, content: candidate.content, references: [] }
}

describe("solve-only supplementary reference propagation", () => {
  let directory: string

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "openmath-reference-propagation-"))
  })

  afterEach(() => {
    mock.restore()
    rmSync(directory, { recursive: true, force: true })
  })

  test("solver receives supplementary reference snapshot", async () => {
    // given
    let solverPayload: Record<string, unknown> | undefined
    dispatchSubagent = async (call) => {
      const payload = parseDispatchedPayload(call.prompt)
      if (call.agentToUse === "solver-markdown") {
        solverPayload = payload
        return { ok: true, sessionID: "solver", text: createCharacterizationArtifacts() }
      }
      if (call.agentToUse === "reference-reviewer-markdown") {
        return { ok: true, sessionID: "reviewer", text: createReviewResult(payload, "[CORRECT]") }
      }
      return { ok: false, error: `Unexpected agent ${call.agentToUse}` }
    }
    const tool = createOpenMathSolveOnlyTool({
      directory,
      client: Object.create(null),
      openmathConfig: { artifacts: { format: "markdown" } },
    })

    // when
    await tool.execute({
      session_id: "root",
      supplementary_refs: [...CHARACTERIZATION_REFS],
      problems: [{ id: "p1", problem: "Prove the result." }],
    }, context)

    // then
    expect(solverPayload).toBeDefined()
    expect(supplementaryBundle(solverPayload ?? {}, "solve")).toEqual(
      renderReferenceBundle(createLegacyReferenceSnapshot(CHARACTERIZATION_REFS), "solve"),
    )
  })

  test("reviewer and reviser receive supplementary reference snapshot", async () => {
    // given
    const payloads = new Map<string, Record<string, unknown>>()
    dispatchSubagent = async (call) => {
      const payload = parseDispatchedPayload(call.prompt)
      payloads.set(call.agentToUse, payload)
      if (call.agentToUse === "solver-markdown") {
        return { ok: true, sessionID: "solver", text: createCharacterizationArtifacts() }
      }
      if (call.agentToUse === "solver-markdown-patch") {
        return { ok: true, sessionID: "reviser", text: JSON.stringify({ base_hash: payload.base_hash, ops: [] }) }
      }
      if (call.agentToUse === "reference-reviewer-markdown") {
        const verdict = payload.review_round === 1 ? "[ERROR]" : "[CORRECT]"
        return { ok: true, sessionID: "reviewer", text: createReviewResult(payload, verdict) }
      }
      return { ok: false, error: `Unexpected agent ${call.agentToUse}` }
    }
    const tool = createOpenMathSolveOnlyTool({
      directory,
      client: Object.create(null),
      openmathConfig: { artifacts: { format: "markdown" }, max_review_rounds: 3 },
    })

    // when
    await tool.execute({
      session_id: "root",
      supplementary_refs: [...CHARACTERIZATION_REFS],
      problems: [{ id: "p1", problem: "Prove the result." }],
    }, context)

    // then
    expect([
      supplementaryBundle(payloads.get("reference-reviewer-markdown") ?? {}, "review"),
      supplementaryBundle(payloads.get("solver-markdown-patch") ?? {}, "revise"),
    ]).toEqual([
      renderReferenceBundle(createLegacyReferenceSnapshot(CHARACTERIZATION_REFS), "review"),
      renderReferenceBundle(createLegacyReferenceSnapshot(CHARACTERIZATION_REFS), "revise"),
    ])
  })
})
