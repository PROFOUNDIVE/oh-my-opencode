import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import { startWorkflowFromSnapshots } from "../../workflow/application/start-workflow-from-snapshots"
import { startWorkflowState } from "../../workflow/storage"
import { ReferenceSnapshotSchema } from "../../workflow/state"
import { buildCampaignSourceSnapshot } from "../application/build-campaign-source-snapshot"
import { createInitialCampaignState } from "../application/create-initial-campaign-state"
import {
  objectiveSnapshot,
  profileSnapshot,
  referenceSnapshot,
  removeTemporaryCampaignDirectory,
  temporaryCampaignDirectory,
} from "../application/application-test-fixture"
import { stepResearchCampaign } from "../application"
import { startResearchCampaignState } from "../storage"
import { createCandidateDiscoveryStepDependencies } from "./candidate-discovery-operations"
import { FakeCandidateTransport } from "./candidate-discovery-test-runtime"

describe("candidate child collision", () => {
  let directory: string

  beforeEach(() => {
    directory = temporaryCampaignDirectory()
  })

  afterEach(() => {
    removeTemporaryCampaignDirectory(directory)
  })

  test("rejects different frozen snapshots before exposing them to a sibling session", async () => {
    // given
    const profile = profileSnapshot()
    const references = referenceSnapshot()
    const initial = createInitialCampaignState({
      campaign_id: "campaign-a",
      parent_session_id: "ses_parent",
      source_snapshot: buildCampaignSourceSnapshot({ objective: objectiveSnapshot(), profile, references }),
    })
    await startResearchCampaignState({ directory, state: initial })
    await startWorkflowFromSnapshots({
      directory,
      run_id: "campaign-a::direct-01",
      parent_session_id: "ses_parent",
      request_snapshot: { kind: "markdown", instruction: "COLLIDING_OBJECTIVE_SENTINEL" },
      profile_snapshot: profile.candidate_workflow_profile,
      reference_snapshot: ReferenceSnapshotSchema.parse(references),
      artifact: undefined,
    }, { start_state: startWorkflowState })
    const transport = new FakeCandidateTransport()

    // when
    const result = await stepResearchCampaign({
      directory,
      campaign_id: initial.campaign_id,
      expected_state_revision: 0,
      mode: "one_stage",
    }, createCandidateDiscoveryStepDependencies({ directory, create_job_runtime: (callbacks) => transport.runtime(callbacks) }))

    // then
    expect(result).toMatchObject({ ok: false, error_code: "CHILD_WORKFLOW_FAILED" })
    expect(transport.requests.length).toBeLessThanOrEqual(1)
    expect(transport.requests.every((request) => !request.user_prompt.includes("COLLIDING_OBJECTIVE_SENTINEL"))).toBe(true)
  })
})
