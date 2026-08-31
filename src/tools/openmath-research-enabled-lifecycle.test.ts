import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import { OpenMathConfigSchema } from "../config/schema"
import {
  removeTemporaryCampaignDirectory,
  temporaryCampaignDirectory,
} from "../openmath/research/application/application-test-fixture"
import { certifiedPromotionFixture } from "../openmath/research/certification/application/certification-application-test-fixture"
import { readyCertificationState } from "../openmath/research/certification/state/certification-test-fixture"
import { ResearchCertificationStateV1Schema } from "../openmath/research/certification/state/schema"
import { createOpenMathResearchAbortTool } from "./openmath-research-abort"
import { createOpenMathResearchAmendTool } from "./openmath-research-amend"
import { createOpenMathResearchPromoteTool } from "./openmath-research-promote"
import { createOpenMathResearchStartTool } from "./openmath-research-start"
import { createOpenMathResearchStatusTool } from "./openmath-research-status"
import { createOpenMathResearchStepTool } from "./openmath-research-step"
import { researchToolConfig, researchToolContext } from "./openmath-research-test-support"

describe("enabled research tool lifecycle", () => {
  let directory: string

  beforeEach(() => {
    directory = temporaryCampaignDirectory()
  })

  afterEach(() => {
    removeTemporaryCampaignDirectory(directory)
  })

  test("start and status expose the separate NOT_STARTED branch", async () => {
    // given
    const start = createOpenMathResearchStartTool({ directory, openmathConfig: enabledConfig() })
    const status = createOpenMathResearchStatusTool({ directory })

    // when
    const started = JSON.parse(await start.execute({
      campaign_id: "campaign-enabled-start",
      objective: { kind: "markdown", instruction: "Prove it." },
    }, researchToolContext()))
    const read = JSON.parse(await status.execute({ campaign_id: "campaign-enabled-start" }, researchToolContext()))

    // then
    expect(started).toMatchObject({ ok: true, certification: { status: "NOT_STARTED", certification_revision: null } })
    expect(read).toEqual(started)
  })

  test("step requires and returns certification revision through the existing factory", async () => {
    // given
    const fixture = certifiedPromotionFixture()
    const certification = ResearchCertificationStateV1Schema.parse(readyCertificationState())
    const step = createOpenMathResearchStepTool({
      directory,
      createStepDependencies: () => ({
        read_state: async () => ({ kind: "ok", state: fixture.campaign }),
        plan_operation: () => ({ ok: false, error_code: "ILLEGAL_TRANSITION", message: "must not plan campaign work" }),
        run_operation: async () => ({ ok: false, error_code: "ILLEGAL_TRANSITION", message: "must not run campaign work" }),
        prepare_dossier: async () => ({ kind: "error", error_code: "VALIDATION_ERROR", message: "must not build V1" }),
        step_certification: async () => ({ kind: "ok", state: certification }),
      }),
    })

    // when
    const result = JSON.parse(await step.execute({
      campaign_id: fixture.campaign.campaign_id,
      expected_state_revision: fixture.campaign.state_revision,
      expected_certification_revision: null,
      mode: "one_stage",
    }, researchToolContext()))

    // then
    expect(result).toMatchObject({
      ok: true,
      certification: { status: "READY", certification_revision: 0 },
    })
    expect(result.certification.next_actions.every((action: Record<string, unknown>) => action.required_certification_revision === 0)).toBe(true)
  })

  test("amend, promote, and abort enforce enabled lifecycle inputs", async () => {
    // given
    const start = createOpenMathResearchStartTool({ directory, openmathConfig: enabledConfig() })
    const started = JSON.parse(await start.execute({
      campaign_id: "campaign-enabled-mutations",
      objective: { kind: "markdown", instruction: "Prove it." },
    }, researchToolContext()))
    const amend = createOpenMathResearchAmendTool({ directory })
    const promote = createOpenMathResearchPromoteTool({ directory })
    const abort = createOpenMathResearchAbortTool({ directory })

    // when
    const amendment = JSON.parse(await amend.execute({
      campaign_id: "campaign-enabled-mutations",
      expected_state_revision: started.state_revision,
      expected_certification_revision: 0,
      operation: "add",
      kind: "question",
      scope: "graph",
      content: "Check the graph.",
    }, researchToolContext()))
    const promotion = JSON.parse(await promote.execute({
      campaign_id: "campaign-enabled-mutations",
      expected_state_revision: started.state_revision,
      dossier_sha256: "a".repeat(64),
      decision: "reject",
    }, researchToolContext()))
    const aborted = JSON.parse(await abort.execute({
      campaign_id: "campaign-enabled-mutations",
      expected_state_revision: started.state_revision,
      expected_certification_revision: null,
      reason: "stop",
    }, researchToolContext()))

    // then
    expect(amendment).toMatchObject({ ok: false, error_code: "CAMPAIGN_NOT_ELIGIBLE" })
    expect(promotion).toMatchObject({ ok: false, error_code: "VALIDATION_ERROR" })
    expect(aborted).toMatchObject({ ok: true, status: "ABORTED", certification: { effective_status: "ABORTED" } })
  })
})

function enabledConfig() {
  const base = researchToolConfig()
  const profiles = base.research_profiles
  if (profiles === undefined) throw new TypeError("Research profiles are unavailable")
  const profile = profiles["phase-a"]
  if (profile === undefined) throw new TypeError("Phase A profile is unavailable")
  const certificationRole = {
    agent: "certifier",
    model: "openai/gpt-5",
    prompt: { kind: "inline" as const, content: "Certify it." },
  }
  return OpenMathConfigSchema.parse({
    ...base,
    research_profiles: {
      ...profiles,
      "phase-a": {
        ...profile,
        certification: {
          schema_version: 1,
          extraction_role: certificationRole,
          coverage_role: certificationRole,
          counterexample_role: certificationRole,
          witness_role: certificationRole,
          max_obligations: 16,
          max_coverage_rounds: 2,
          max_coverage_findings: 8,
          allowed_attack_modes: ["EDGE_CASE"],
          max_attacks_per_obligation: 1,
          max_active_certification_jobs: 2,
        },
      },
    },
  })
}
