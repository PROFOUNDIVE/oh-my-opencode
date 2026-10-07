import { expect, test } from "bun:test"
import { createOpencodeClient } from "@opencode-ai/sdk"
import { mkdirSync } from "node:fs"

import { temporaryCampaignDirectory, removeTemporaryCampaignDirectory } from "../../application/application-test-fixture"
import { createCampaignDispatchRuntime } from "../../scheduler/campaign-dispatch-runtime"
import { acquireCertificationOperationLock, releaseCertificationOperationLock } from "../storage"
import { createCertificationDispatchRuntime } from "./certification-dispatch-runtime"
import { researchToolContext } from "../../../../tools/openmath-research-test-support"
import { getResearchCampaignDirectory } from "../../storage"

test("checks local certification ownership while querying project sessions", async () => {
  // given
  const directory = temporaryCampaignDirectory()
  const storageDirectory = temporaryCampaignDirectory()
  const queriedDirectories: Array<string | null> = []
  const client = createOpencodeClient({
    baseUrl: "http://research.test",
    fetch: async (request) => {
      const url = new URL(request.url)
      queriedDirectories.push(url.searchParams.get("directory"))
      return Response.json(url.pathname.endsWith("/ses_child1") ? { title: "child" } : [])
    },
  })
  mkdirSync(getResearchCampaignDirectory(storageDirectory, "campaign-a"), { recursive: true })
  const lock = await acquireCertificationOperationLock({ directory: storageDirectory, campaign_id: "campaign-a", operation_id: "certification-step-1" })
  if (lock.kind !== "acquired") throw new TypeError("Expected certification operation lock")
  const callbacks = {
    persist_job_attempt: async () => ({ ok: false as const, error_code: "STORAGE_WRITE_FAILED" as const, message: "unused" }),
    block_reconciliation: async () => ({ ok: false as const, error_code: "STORAGE_WRITE_FAILED" as const, message: "unused" }),
  }
  const certification = createCertificationDispatchRuntime({
    directory, storageDirectory, client, ctx: researchToolContext(), campaign_id: "campaign-a",
    operation_owner: { operation_id: lock.owner.operation_id, token: lock.owner.token }, ...callbacks,
  })
  const campaign = createCampaignDispatchRuntime({ directory, client, ctx: researchToolContext(), ...callbacks })

  try {
    // when
    const ownership = await certification.verify_operation_owner()
    for (const runtime of [certification, campaign]) {
      await runtime.list_children("ses_parent1")
      await runtime.get_session("ses_child1")
      await runtime.list_messages("ses_child1")
    }

    // then
    expect(ownership).toEqual({ ok: true })
    expect(queriedDirectories).toEqual(Array.from({ length: 6 }, () => directory))
  } finally {
    await releaseCertificationOperationLock({ directory: storageDirectory, campaign_id: "campaign-a", token: lock.owner.token })
    removeTemporaryCampaignDirectory(directory)
    removeTemporaryCampaignDirectory(storageDirectory)
  }
})
