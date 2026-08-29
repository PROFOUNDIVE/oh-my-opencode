import { describe, expect, test } from "bun:test"

import { sha256 } from "../../workflow/stage-runner/sha256"
import { adaptScreenOutput } from "./screen-output-adapter"
import { buildScreenReceipt } from "./screen-receipt"
import { screenReceiptInput } from "./screen-receipt.test-support"

const HASH_A = "a".repeat(64)

describe("screen output adapter", () => {
  test("accepts exactly each of the four categorical verdicts", () => {
    // given
    const verdicts = ["VIABLE", "REPAIRABLE", "FATAL_FLAW", "INCONCLUSIVE"] as const

    // when
    const results = verdicts.map((verdict) => adaptScreenOutput(validOutput(verdict)))

    // then
    expect(results.map((result) => result.ok && result.output.verdict)).toEqual(verdicts)
  })

  test("preserves all four normalized arrays as opaque text", () => {
    // given
    const rawOutput = JSON.stringify({
      verdict: "REPAIRABLE",
      blocking_issues: ["  Keep exact spacing.  "],
      unresolved_obligations: ["Claim X still needs a proof; do not interpret this string."],
      assumptions: ["Assume choice."],
      novel_elements: ["A new reduction."],
    })

    // when
    const result = adaptScreenOutput(rawOutput)

    // then
    expect(result.ok).toBe(true)
    if (!result.ok) throw new TypeError("Expected valid normalized screen output")
    expect(result.output.blocking_issues).toEqual(["  Keep exact spacing.  "])
    expect(result.output.unresolved_obligations).toEqual([
      "Claim X still needs a proof; do not interpret this string.",
    ])
    expect(result.output.assumptions).toEqual(["Assume choice."])
    expect(result.output.novel_elements).toEqual(["A new reduction."])
    expect(typeof result.output.unresolved_obligations[0]).toBe("string")
    expect(Object.isFrozen(result.output.unresolved_obligations)).toBe(true)
  })

  test("rejects unknown and numeric score, rank, and probability fields", () => {
    // given
    const invalid = [
      { ...validObject(), unknown: "field" },
      { ...validObject(), score: 0.8 },
      { ...validObject(), rank: 1 },
      { ...validObject(), probability: 0.5 },
      { ...validObject(), confidence: 99 },
    ]

    // when
    const results = invalid.map((value) => adaptScreenOutput(JSON.stringify(value)))

    // then
    expect(results.every((result) => !result.ok)).toBe(true)
  })

  test("rejects duplicate and ambiguous verdict representations", () => {
    // given
    const invalid = [
      duplicateVerdict("VIABLE", "VIABLE"),
      duplicateVerdict("VIABLE", "FATAL_FLAW"),
      JSON.stringify({ ...validObject(), verdicts: ["VIABLE", "REPAIRABLE"] }),
      `${validOutput("VIABLE")}\nVERDICT: FATAL_FLAW`,
    ]

    // when
    const results = invalid.map(adaptScreenOutput)

    // then
    expect(results.every((result) => !result.ok)).toBe(true)
    expect(results.slice(0, 2).every((result) => !result.ok && result.error.code === "DUPLICATE_FIELD")).toBe(true)
  })

  test("rejects malformed JSON and Markdown wrappers", () => {
    // given
    const invalid = [
      "",
      "not json",
      "VERDICT: VIABLE",
      `\`\`\`json\n${validOutput("VIABLE")}\n\`\`\``,
      `Review follows:\n${validOutput("VIABLE")}`,
      `${validOutput("VIABLE")} trailing prose`,
      validOutput("VIABLE").replace(/}$/, ",}"),
      `/* comment */ ${validOutput("VIABLE")}`,
    ]

    // when
    const results = invalid.map(adaptScreenOutput)

    // then
    expect(results.every((result) => !result.ok)).toBe(true)
  })

  test("rejects claimed proof and Phase B-D semantic objects", () => {
    // given
    const fields = [
      "proof", "certificate", "witness", "verification", "counterexample",
      "lean", "formal_verifier", "novelty", "obligations", "obligation_graph",
      "dependency", "status", "result",
    ]
    const invalid = fields.map((field) => ({ ...validObject(), [field]: { claimed: true } }))

    // when
    const results = invalid.map((value) => adaptScreenOutput(JSON.stringify(value)))

    // then
    expect(results.every((result) => !result.ok)).toBe(true)
  })

  test("rejects non-string members in every normalized array", () => {
    // given
    const fields = ["blocking_issues", "unresolved_obligations", "assumptions", "novel_elements"] as const
    const invalid = fields.flatMap((field) => [
      { ...validObject(), [field]: [1] },
      { ...validObject(), [field]: [{ text: "semantic object" }] },
      { ...validObject(), [field]: [""] },
    ])

    // when
    const results = invalid.map((value) => adaptScreenOutput(JSON.stringify(value)))

    // then
    expect(results.every((result) => !result.ok)).toBe(true)
  })

  test("binds normalized output to internal provenance and the raw output hash", () => {
    // given
    const rawOutput = validOutput("INCONCLUSIVE")

    // when
    const result = buildScreenReceipt(screenReceiptInput(rawOutput))

    // then
    expect(result.ok).toBe(true)
    if (!result.ok) throw new TypeError("Expected valid screen receipt")
    const receipt = result.receipt
    expect(receipt).toMatchObject({
      verdict: "INCONCLUSIVE",
      reviewer_session_id: "ses_screenReviewer1",
      resolved_model: { providerID: "anthropic", modelID: "claude-opus" },
      profile_sha256: HASH_A,
      prompt_sha256: "b".repeat(64),
      reference_sha256: "c".repeat(64),
      raw_output_sha256: sha256(rawOutput),
      attachments: [],
    })
    expect(receipt.artifact.sha256).toBe(sha256("Proof candidate"))
    expect(receipt.unresolved_obligations).toEqual(["Opaque obligation prose."])
    expect(Object.keys(receipt).some((key) => key.includes("obligation_") || key === "obligations")).toBe(false)
  })

  test("derives normalized fields from the same raw output that it hashes", () => {
    // given
    const input = {
      ...screenReceiptInput(validOutput("FATAL_FLAW")),
      output: { ...validObject(), verdict: "VIABLE" },
    }

    // when
    const result = buildScreenReceipt(input)

    // then
    expect(result.ok).toBe(true)
    if (!result.ok) throw new TypeError("Expected valid screen receipt")
    expect(result.receipt.verdict).toBe("FATAL_FLAW")
    expect(result.receipt.raw_output_sha256).toBe(sha256(input.raw_output))
  })

  test("rejects a target artifact whose bytes do not match its reference hash", () => {
    // given
    const valid = screenReceiptInput(validOutput("VIABLE"))
    const input = { ...valid, target_artifact: { ...valid.target_artifact, content: "Tampered content" } }

    // when
    const result = buildScreenReceipt(input)

    // then
    expect(result).toMatchObject({ ok: false, error: { code: "ARTIFACT_HASH_MISMATCH" } })
  })

  test("does not let model output supply or override receipt provenance", () => {
    // given
    const forbidden = [
      "candidate_id", "artifact", "profile_sha256", "prompt_sha256", "reference_sha256",
      "reviewer_session_id", "resolved_model", "raw_output_sha256", "timestamp", "lineage",
    ]

    // when
    const results = forbidden.map((field) => adaptScreenOutput(JSON.stringify({
      ...validObject(),
      [field]: field === "artifact" || field === "resolved_model" ? {} : "MODEL_INJECTED_PROVENANCE",
    })))

    // then
    expect(results.every((result) => !result.ok)).toBe(true)
  })
})

function validOutput(verdict: "VIABLE" | "REPAIRABLE" | "FATAL_FLAW" | "INCONCLUSIVE"): string {
  return JSON.stringify({ ...validObject(), verdict })
}

function validObject() {
  return {
    verdict: "VIABLE",
    blocking_issues: ["Blocking issue."],
    unresolved_obligations: ["Opaque obligation prose."],
    assumptions: ["Assumption."],
    novel_elements: ["Novel element prose."],
  }
}

function duplicateVerdict(first: string, second: string): string {
  return `{"verdict":"${first}","verdict":"${second}","blocking_issues":[],"unresolved_obligations":[],"assumptions":[],"novel_elements":[]}`
}
