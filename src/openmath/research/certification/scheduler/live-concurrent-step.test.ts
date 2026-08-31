import { afterEach, expect, test } from "bun:test"

import {
  acquireCertificationOperationLock,
  readCertificationGeneration,
  releaseCertificationOperationLock,
} from "../storage"
import {
  certificationJobProgressInput,
  certificationJobRuntime,
  removeCertificationJobTestDirectories,
  runningCertificationJobSetup,
} from "./certification-job-operation-test-fixture"
import { progressCertificationJobAttempt } from "./progress-certification-job-attempt"
import { verifyCertificationOperationOwner } from "./verify-certification-operation-owner"

afterEach(() => {
  removeCertificationJobTestDirectories()
})

test("a live concurrent explicit step cannot dispatch beside the operation-lock owner", async () => {
  // given
  const setup = await runningCertificationJobSetup()
  const first = await acquireCertificationOperationLock({
    directory: setup.directory,
    campaign_id: setup.identity.campaign_id,
    operation_id: "certification-step-live",
  })
  if (first.kind === "error") throw new TypeError(first.message)
  const second = await acquireCertificationOperationLock({
    directory: setup.directory,
    campaign_id: setup.identity.campaign_id,
    operation_id: "certification-step-live",
  })
  const messages: string[] = []
  let dispatches = 0
  const runtime = certificationJobRuntime(setup, {
    list_messages: async () => messages.map((text) => ({ role: "user", text })),
    dispatch: async (request) => {
      dispatches += 1
      const sessionID = "ses_child1"
      await request.awaited_callbacks.on_session_created?.(sessionID)
      messages.push(`${request.prompt_marker}${request.user_prompt}`)
      await request.awaited_callbacks.on_prompt_sent?.(sessionID)
      return { ok: true, session_id: sessionID, text: "output" }
    },
  })

  // when
  const result = await progressCertificationJobAttempt(certificationJobProgressInput(setup.attempt, runtime, setup.receipt))
  const released = await releaseCertificationOperationLock({
    directory: setup.directory,
    campaign_id: setup.identity.campaign_id,
    token: first.owner.token,
  })

  // then
  expect(second).toMatchObject({ kind: "error", error_code: "STORAGE_BUSY" })
  expect(result).toMatchObject({ kind: "completed" })
  expect(dispatches).toBe(1)
  expect(released).toEqual({ kind: "ok" })
})

test("read-only certification status performs zero dispatches", async () => {
  // given
  const setup = await runningCertificationJobSetup()
  let dispatches = 0
  certificationJobRuntime(setup, {
    dispatch: async () => {
      dispatches += 1
      return { ok: false, error: "unexpected dispatch" }
    },
  })

  // when
  const status = await readCertificationGeneration({ directory: setup.directory, ...setup.identity })

  // then
  expect(status).toMatchObject({ kind: "ok", state: { status: "RUNNING" } })
  expect(dispatches).toBe(0)
})

test("refuses reconciliation and dispatch when explicit-step ownership is not proven", async () => {
  // given
  const setup = await runningCertificationJobSetup()
  let dispatches = 0
  const runtime = certificationJobRuntime(setup, {
    verify_operation_owner: async () => ({ ok: false, error_code: "STORAGE_BUSY", message: "another step owns the campaign" }),
    dispatch: async () => {
      dispatches += 1
      return { ok: true, session_id: "ses_child1", text: "unexpected" }
    },
  })

  // when
  const result = await progressCertificationJobAttempt(certificationJobProgressInput(setup.attempt, runtime, setup.receipt))

  // then
  expect(result).toEqual({ kind: "error", error_code: "STORAGE_BUSY", message: "another step owns the campaign" })
  expect(dispatches).toBe(0)
})

test("proves the current campaign operation owner from the shared lock authority", async () => {
  // given
  const setup = await runningCertificationJobSetup()
  const acquired = await acquireCertificationOperationLock({
    directory: setup.directory,
    campaign_id: setup.identity.campaign_id,
    operation_id: "certification-step-owner",
  })
  if (acquired.kind !== "acquired") throw new TypeError("Expected operation lock")

  // when
  const result = await verifyCertificationOperationOwner({
    directory: setup.directory,
    campaign_id: setup.identity.campaign_id,
    owner: acquired.owner,
  })

  // then
  expect(result).toEqual({ ok: true })
})

test("rejects a stale operation token from the shared lock authority", async () => {
  // given
  const setup = await runningCertificationJobSetup()
  const acquired = await acquireCertificationOperationLock({
    directory: setup.directory,
    campaign_id: setup.identity.campaign_id,
    operation_id: "certification-step-owner",
  })
  if (acquired.kind !== "acquired") throw new TypeError("Expected operation lock")

  // when
  const result = await verifyCertificationOperationOwner({
    directory: setup.directory,
    campaign_id: setup.identity.campaign_id,
    owner: { ...acquired.owner, token: "stale-owner-token" },
  })

  // then
  expect(result).toMatchObject({ ok: false, error_code: "STORAGE_BUSY" })
})
