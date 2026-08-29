import { CampaignJobAttemptSchema, type CampaignJobAttempt } from "../state"

type CompletedJob = Extract<CampaignJobAttempt, { readonly phase: "COMPLETED" }>

export function campaignJobForCommit(attempt: CompletedJob, currentCampaignRevision: number): CompletedJob {
  const parsed = CampaignJobAttemptSchema.parse({
    ...attempt,
    phase_revision: currentCampaignRevision + 1,
  })
  if (parsed.phase !== "COMPLETED") throw new TypeError("Campaign job completion parsed to an unexpected phase")
  return parsed
}
