import { expect, test } from "bun:test"

import { ArtifactDtoSchema } from "../../workflow/state"
import { CandidateArtifactReferenceSchema } from "../state"
import { screenTargetMatchesReference } from "./screen-target"

test("rejects target bytes that differ from the discovered artifact reference", () => {
  // given
  const reference = CandidateArtifactReferenceSchema.parse({
    child_run_id: "campaign-a::direct-01",
    child_state_revision: 2,
    artifact_version: 1,
    media_type: "text/markdown",
    sha256: "a".repeat(64),
  })
  const target = ArtifactDtoSchema.parse({
    version: 1,
    media_type: "text/markdown",
    content: "changed artifact",
    sha256: "a".repeat(64),
  })

  // when
  const matches = screenTargetMatchesReference(target, reference)

  // then
  expect(matches).toBe(false)
})
