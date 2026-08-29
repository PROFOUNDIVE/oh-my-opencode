import { afterEach, describe, expect, test } from "bun:test"

import { CampaignErrorEnvelopeSchema, CampaignSuccessEnvelopeSchema } from "../application"
import { readResearchCampaignState } from "../storage"
import { createOpenMathResearchTools } from "../../../tools/openmath-research-tools"
import { researchToolConfig, researchToolContext } from "../../../tools/openmath-research-test-support"
import { removeTemporaryCampaignDirectory, temporaryCampaignDirectory } from "../application/application-test-fixture"
import { createFactoryStepDependencies } from "./tool-factory-dependencies"

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) removeTemporaryCampaignDirectory(directory)
})

describe("Phase A public step races", () => {
  test("admits one operation owner and rejects a concurrent stale step without duplicate dispatch", async () => {
    // given
    const harness = await raceHarness("campaign-race")
    let release: (() => void) | undefined
    let entered: (() => void) | undefined
    const held = new Promise<void>((resolve) => { release = resolve })
    const started = new Promise<void>((resolve) => { entered = resolve })
    const dependencies = {
      ...harness.dependencies,
      run_operation: async (operation: Parameters<typeof harness.dependencies.run_operation>[0]) => {
        entered?.()
        await held
        return harness.dependencies.run_operation(operation)
      },
    }
    const tools = harness.tools(dependencies)

    // when
    const owner = tools.openmath_research_step.execute({
      campaign_id: harness.campaignId, expected_state_revision: 0,
    }, harness.context)
    const contenderPromise = tools.openmath_research_step.execute({
      campaign_id: harness.campaignId, expected_state_revision: 0,
    }, harness.context)
    await started
    release?.()
    const concurrent = (await Promise.all([owner, contenderPromise])).map((value) => JSON.parse(String(value)))
    const successes = concurrent.filter((value) => CampaignSuccessEnvelopeSchema.safeParse(value).success)
    const contenders = concurrent.flatMap((value) => {
      const parsed = CampaignErrorEnvelopeSchema.safeParse(value)
      return parsed.success ? [parsed.data] : []
    })
    const stale = error(await tools.openmath_research_step.execute({
      campaign_id: harness.campaignId, expected_state_revision: 0,
    }, harness.context))

    // then
    expect(successes).toHaveLength(1)
    expect(contenders).toHaveLength(1)
    expect(["STALE_STATE_REVISION", "STORAGE_BUSY"]).toContain(contenders[0]?.error_code)
    expect(stale).toMatchObject({ error_code: "STALE_STATE_REVISION" })
    expect(harness.transports.candidate.requests).toHaveLength(2)
    const stored = await state(harness.directory, harness.campaignId)
    expect(stored.job_attempts.filter((job) => job.phase === "COMMITTED")).toHaveLength(2)
  })

  test("gives abort precedence after all in-flight siblings settle", async () => {
    // given
    const harness = await raceHarness("campaign-abort")
    let release: (() => void) | undefined
    let entered: (() => void) | undefined
    const held = new Promise<void>((resolve) => { release = resolve })
    const started = new Promise<void>((resolve) => { entered = resolve })
    const dependencies = {
      ...harness.dependencies,
      run_operation: async (operation: Parameters<typeof harness.dependencies.run_operation>[0]) => {
        entered?.()
        await held
        return harness.dependencies.run_operation(operation)
      },
    }
    const tools = harness.tools(dependencies)
    const running = tools.openmath_research_step.execute({
      campaign_id: harness.campaignId, expected_state_revision: 0,
    }, harness.context)
    await started

    // when
    const aborted = success(await tools.openmath_research_abort.execute({
      campaign_id: harness.campaignId, expected_state_revision: 1, reason: "human stop",
    }, harness.context))
    release?.()
    const settled = await Promise.allSettled([running])

    // then
    expect(aborted).toMatchObject({ status: "RUNNING" })
    expect(settled[0]?.status).toBe("fulfilled")
    const final = success(await harness.tools(dependencies).openmath_research_status.execute({
      campaign_id: harness.campaignId,
    }, harness.context))
    expect(final).toMatchObject({ status: "ABORTED", next_actions: [] })
    expect(harness.transports.candidate.requests).toHaveLength(2)
    const stored = await state(harness.directory, harness.campaignId)
    expect(stored.candidates.every((candidate) => candidate.artifact === null)).toBe(true)
  })
})

async function raceHarness(campaignId: string) {
  const directory = temporaryCampaignDirectory()
  directories.push(directory)
  const context = researchToolContext("ses_RaceOwner", "msg_RaceOwner")
  const wired = createFactoryStepDependencies(directory, "KEEP")
  const tools = (dependencies: typeof wired.dependencies) => createOpenMathResearchTools({
    directory,
    openmathConfig: researchToolConfig(),
    createStepDependencies: () => dependencies,
  })
  success(await tools(wired.dependencies).openmath_research_start.execute({
    campaign_id: campaignId,
    objective: { kind: "markdown", instruction: "Prove the race objective." },
  }, context))
  return { directory, campaignId, context, dependencies: wired.dependencies, transports: wired.transports, tools }
}

function success(value: unknown) {
  return CampaignSuccessEnvelopeSchema.parse(JSON.parse(String(value)))
}

function error(value: unknown) {
  return CampaignErrorEnvelopeSchema.parse(JSON.parse(String(value)))
}

async function state(directory: string, campaignId: string) {
  const result = await readResearchCampaignState(directory, campaignId)
  if (result.kind === "error") throw new TypeError(result.message)
  return result.state
}
