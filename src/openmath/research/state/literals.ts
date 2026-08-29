import { z } from "zod"

const SLUG_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/

export const CampaignPhaseSchema = z.enum([
  "DISCOVERY",
  "SCREENING",
  "TOURNAMENT",
  "DEEP_REFINEMENT",
  "PROMOTION",
])

export const CampaignStatusSchema = z.enum([
  "READY",
  "RUNNING",
  "AWAITING_HUMAN",
  "BLOCKED",
  "PROMOTION_READY",
  "REJECTED",
  "ABORTED",
])

export const ResearchAwaitingReasonSchema = z.enum([
  "AFTER_INITIAL_SCREEN",
  "TOURNAMENT_NEEDS_HUMAN",
  "CHILD_WORKFLOW_INTERVENTION",
  "BEFORE_PROMOTION",
])

export const CampaignIdSchema = z.string().regex(SLUG_PATTERN).max(128).brand("ResearchCampaignId")
export const CandidateIdSchema = z.string().regex(SLUG_PATTERN).max(128).brand("ResearchCandidateId")
export const CampaignJobIdSchema = z.string().regex(/^job-[a-z0-9]+(?:[._-][a-z0-9]+)*$/).max(132).brand("ResearchCampaignJobId")
export const ScreenIdSchema = z.string().regex(/^screen-[a-z0-9]+(?:[._-][a-z0-9]+)*$/).max(135).brand("ResearchScreenId")
export const TournamentIdSchema = z.string().regex(/^tournament-[a-z0-9]+(?:[._-][a-z0-9]+)*$/).max(139).brand("ResearchTournamentId")
export const ChildRunIdSchema = z.string().regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*::[a-z0-9]+(?:[._-][a-z0-9]+)*$/).max(258).brand("ResearchChildRunId")
export const CampaignSessionIdSchema = z.string().regex(/^ses_[A-Za-z0-9]+$/).brand("ResearchCampaignSessionId")
export const CampaignHashSchema = z.string().regex(/^[a-f0-9]{64}$/).brand("ResearchCampaignSha256")
export const CampaignRevisionSchema = z.number().int().nonnegative().max(999_999_999_999)
export const NonBlankSchema = z.string().refine((value) => value.trim().length > 0)

export type CampaignPhase = z.infer<typeof CampaignPhaseSchema>
export type CampaignStatus = z.infer<typeof CampaignStatusSchema>
export type ResearchAwaitingReason = z.infer<typeof ResearchAwaitingReasonSchema>
export type CampaignId = z.infer<typeof CampaignIdSchema>
export type CandidateId = z.infer<typeof CandidateIdSchema>
export type CampaignJobId = z.infer<typeof CampaignJobIdSchema>
export type CampaignSessionId = z.infer<typeof CampaignSessionIdSchema>
