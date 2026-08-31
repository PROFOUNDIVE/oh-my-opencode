import { describe, expect, test } from "bun:test"

import { OpenMathResearchEnabledAbortInputSchema } from "./openmath-research-abort/types"
import { OpenMathResearchEnabledAmendInputSchema } from "./openmath-research-amend/types"
import { OpenMathResearchEnabledPromoteInputSchema } from "./openmath-research-promote/types"
import { OpenMathResearchEnabledStepInputSchema } from "./openmath-research-step/types"

describe("enabled research tool inputs", () => {
  test("requires a certification revision on step and promote", () => {
    // given
    const step = { campaign_id: "campaign-enabled", expected_state_revision: 2, mode: "one_stage" }
    const promote = { campaign_id: "campaign-enabled", expected_state_revision: 2, dossier_sha256: "a".repeat(64), decision: "reject" }

    // when
    const results = [
      OpenMathResearchEnabledStepInputSchema.safeParse(step),
      OpenMathResearchEnabledStepInputSchema.safeParse({ ...step, expected_certification_revision: null }),
      OpenMathResearchEnabledPromoteInputSchema.safeParse(promote),
      OpenMathResearchEnabledPromoteInputSchema.safeParse({ ...promote, expected_certification_revision: 7 }),
    ]

    // then
    expect(results.map((result) => result.success)).toEqual([false, true, false, true])
  })

  test("accepts only exact certification amendment scopes", () => {
    // given
    const input = {
      campaign_id: "campaign-enabled",
      expected_state_revision: 2,
      expected_certification_revision: 3,
      operation: "add",
      kind: "question",
      content: "Check it.",
    }

    // when
    const scopes = [
      "graph",
      "coverage",
      "counterexample:obligation-0001",
      "witness:attack-0001",
      "counterexample:attack-0001",
      "witness:obligation-0001",
      "graph:obligation-0001",
    ]

    // then
    expect(scopes.map((scope) => OpenMathResearchEnabledAmendInputSchema.safeParse({ ...input, scope }).success)).toEqual([
      true,
      true,
      true,
      true,
      false,
      false,
      false,
    ])
  })

  test("allows abort null only as an explicit enabled value", () => {
    // given
    const input = { campaign_id: "campaign-enabled", expected_state_revision: 2 }

    // when
    const results = [
      OpenMathResearchEnabledAbortInputSchema.safeParse(input),
      OpenMathResearchEnabledAbortInputSchema.safeParse({ ...input, expected_certification_revision: null }),
      OpenMathResearchEnabledAbortInputSchema.safeParse({ ...input, expected_certification_revision: 0 }),
      OpenMathResearchEnabledAbortInputSchema.safeParse({ ...input, expected_certification_revision: "0" }),
    ]

    // then
    expect(results.map((result) => result.success)).toEqual([false, true, true, false])
  })
})
