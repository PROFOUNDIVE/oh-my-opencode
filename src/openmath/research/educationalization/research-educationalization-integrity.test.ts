import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"

import { sha256 } from "../../workflow/stage-runner/sha256"
import { WorkflowStateV1Schema, type WorkflowStateV1 } from "../../workflow/state"
import { readWorkflowState } from "../../workflow/storage"
import { educationalizeResearchCampaign } from "./educationalize-research-campaign"
import {
  approvedSource,
  dependenciesFor,
  educationalizationRequest,
} from "./educationalize-research-campaign-test-fixture"

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe("research educationalization integrity", () => {
  test("does not persist PASSED when approved source evidence changes before freeze", async () => {
    const directory = temporaryDirectory()
    const source = approvedSource()
    const control = { dispatches: 0, reviews: ["PASS"] }
    let validations = 0
    const dependencies = {
      ...dependenciesFor(directory, source, control),
      validate_source: async () => {
        validations += 1
        return validations === 1
          ? { ok: true as const, source }
          : { ok: false as const, error_code: "CAMPAIGN_NOT_APPROVED" as const, message: "approval changed" }
      },
    }

    const result = await educationalizeResearchCampaign(educationalizationRequest(directory), dependencies)
    const stored = await readWorkflowState(directory, result.educationalization_id)

    expect(result).toMatchObject({ ok: false, error_code: "CAMPAIGN_NOT_APPROVED" })
    if (stored.kind === "error") throw new TypeError(stored.message)
    expect(stored.state.status).not.toBe("PASSED")
  })

  test("rejects forged PASS provenance and irreversible source-defect histories", async () => {
    const state = await passedState()
    const latest = state.latest_review
    if (latest === null || state.artifact === null) throw new TypeError("Expected passed review and artifact")
    const defectReport = JSON.stringify({
      verdict: "SOURCE_DEFECT",
      blocking_issues: ["Immutable source is defective"],
      checks_performed: ["reference_solution_consistency"],
    })
    const defectReview = { ...latest, verdict: "INCONCLUSIVE" as const, raw_report: defectReport, raw_report_sha256: sha256(defectReport) }

    expect(WorkflowStateV1Schema.safeParse({ ...state, review_history: [defectReview, ...state.review_history] }).success).toBe(false)
    expect(WorkflowStateV1Schema.safeParse(withLatest(state, { ...latest, raw_report_sha256: "a".repeat(64) })).success).toBe(false)
    expect(WorkflowStateV1Schema.safeParse(withLatest(state, { ...latest, artifact_input_hash: "b".repeat(64) })).success).toBe(false)
    expect(WorkflowStateV1Schema.safeParse(withLatest(state, { ...latest, session_id: "unrelated-reviewer" })).success).toBe(false)
    expect(WorkflowStateV1Schema.safeParse({
      ...state,
      dispatch_attempts: state.dispatch_attempts.filter((attempt) => (
        attempt.phase !== "COMMITTED" || attempt.receipt.kind !== "ARTIFACT"
      )),
    }).success).toBe(false)
  })
})

async function passedState(): Promise<WorkflowStateV1> {
  const directory = temporaryDirectory()
  const source = approvedSource()
  const result = await educationalizeResearchCampaign(
    educationalizationRequest(directory),
    dependenciesFor(directory, source, { dispatches: 0, reviews: ["PASS"] }),
  )
  if (!result.ok) throw new TypeError(result.message)
  const stored = await readWorkflowState(directory, result.educationalization_id)
  if (stored.kind === "error") throw new TypeError(stored.message)
  return stored.state
}

function withLatest(state: WorkflowStateV1, latest: NonNullable<WorkflowStateV1["latest_review"]>): WorkflowStateV1 {
  return {
    ...state,
    latest_review: latest,
    review_history: [...state.review_history.slice(0, -1), latest],
  }
}

function temporaryDirectory(): string {
  const directory = join(process.cwd(), `.tmp-research-integrity-${crypto.randomUUID()}`)
  mkdirSync(directory, { recursive: true })
  directories.push(directory)
  return directory
}
