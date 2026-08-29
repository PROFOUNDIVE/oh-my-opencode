import { z } from "zod"

import type { ResearchCampaignOperationOwner } from "./storage-results"

const ResearchCampaignOperationIdSchema = z.string().min(1).max(256).refine((value) => value.trim() === value)

const ResearchCampaignOperationOwnerSchema = z.object({
  token: z.string().regex(/^[a-zA-Z0-9-]{1,128}$/),
  pid: z.number().int().positive(),
  operation_id: ResearchCampaignOperationIdSchema,
  started_at: z.iso.datetime({ offset: true }),
}).strict()

export function parseResearchCampaignOperationId(operationId: string): string | null {
  const parsed = ResearchCampaignOperationIdSchema.safeParse(operationId)
  return parsed.success ? parsed.data : null
}

export function parseResearchCampaignOperationOwner(content: string): ResearchCampaignOperationOwner | null {
  let input: unknown
  try {
    input = JSON.parse(content)
  } catch (error) {
    if (!(error instanceof Error)) throw error
    return null
  }
  const parsed = ResearchCampaignOperationOwnerSchema.safeParse(input)
  return parsed.success ? parsed.data : null
}

export function serializeResearchCampaignOperationOwner(owner: ResearchCampaignOperationOwner): string {
  return JSON.stringify(owner)
}
