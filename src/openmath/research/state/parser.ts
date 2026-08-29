import { ResearchCampaignStateV1Schema, type ResearchCampaignStateV1 } from "./schema"

export type ResearchCampaignStateReadResult =
  | { readonly kind: "ok"; readonly state: ResearchCampaignStateV1 }
  | { readonly kind: "error"; readonly error_code: "STORAGE_READ_FAILED"; readonly message: string }

export function parseResearchCampaignStateV1(input: unknown): ResearchCampaignStateReadResult {
  const parsed = ResearchCampaignStateV1Schema.safeParse(input)
  if (!parsed.success) {
    return {
      kind: "error",
      error_code: "STORAGE_READ_FAILED",
      message: "Research campaign state is invalid or unsupported",
    }
  }
  return { kind: "ok", state: parsed.data }
}

export function parseResearchCampaignStateV1Json(content: string): ResearchCampaignStateReadResult {
  let input: unknown
  try {
    input = JSON.parse(content)
  } catch {
    return {
      kind: "error",
      error_code: "STORAGE_READ_FAILED",
      message: "Research campaign state is not valid JSON",
    }
  }
  return parseResearchCampaignStateV1(input)
}
