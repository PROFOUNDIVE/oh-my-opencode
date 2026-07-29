import { describe, expect, test } from "bun:test"

import { StageRecordSchema, StageReceiptSchema } from "./state"
import { createWorkflowStateFixture } from "./state/test-fixture"

function blockedRecord() {
  return {
    ...createWorkflowStateFixture().stage_history[0],
    outcome: "BLOCKED",
    raw_session_id: null,
    raw_output: null,
    output_hash: null,
    parsed_result: null,
    parsed_error: {
      kind: "ERROR",
      error_code: "RECONCILIATION_BLOCKED",
      message: "Child reconciliation is ambiguous",
    },
    error_code: "RECONCILIATION_BLOCKED",
  }
}

describe("stage error receipt invariants", () => {
  test("accepts a matching reconciliation-blocked record", () => {
    // given
    const record = blockedRecord()

    // when
    const result = StageRecordSchema.safeParse(record)

    // then
    expect(result.success).toBe(true)
  })

  test("rejects a BLOCKED record carrying a different receipt code", () => {
    // given
    const record = blockedRecord()
    const mismatched = {
      ...record,
      parsed_error: { ...record.parsed_error, error_code: "SUBAGENT_FAILED" },
    }

    // when
    const result = StageRecordSchema.safeParse(mismatched)

    // then
    expect(result.success).toBe(false)
  })

  test("ties adapter metadata exclusively to ADAPTER_OUTPUT_INVALID", () => {
    // given
    const adapterError = {
      kind: "adapter_error",
      code: "INVALID_JSON",
      message: "Output is not JSON",
      raw_output: "bad",
    }
    const receipts = [
      { kind: "ERROR", error_code: "SUBAGENT_FAILED", message: "failed", adapter_error: adapterError },
      { kind: "ERROR", error_code: "RECONCILIATION_BLOCKED", message: "blocked", adapter_error: adapterError },
      { kind: "ERROR", error_code: "ADAPTER_OUTPUT_INVALID", message: "invalid" },
    ]
    const validAdapterReceipt = {
      kind: "ERROR",
      error_code: "ADAPTER_OUTPUT_INVALID",
      message: "invalid",
      adapter_error: adapterError,
    }
    const validSubagentReceipt = { kind: "ERROR", error_code: "SUBAGENT_FAILED", message: "failed" }

    // when
    const invalidResults = receipts.map((receipt) => StageReceiptSchema.safeParse(receipt))
    const validResults = [validAdapterReceipt, validSubagentReceipt].map((receipt) => StageReceiptSchema.safeParse(receipt))

    // then
    expect(invalidResults.every((result) => !result.success)).toBe(true)
    expect(validResults.every((result) => result.success)).toBe(true)
  })
})
