import { ZodError } from "zod"

import { campaignErrorEnvelope, type CampaignApplicationResult } from "../../openmath/research/application"
import { ReferenceManifestError } from "../../openmath/references/types"
import { ProblemRefNotFoundError } from "../openmath-solve-only/problem-ref"

export function jsonResearchResult(result: CampaignApplicationResult): string {
  return JSON.stringify(result)
}

export function jsonResearchException(error: unknown): string {
  if (error instanceof ZodError || error instanceof ProblemRefNotFoundError) {
    return jsonResearchResult(campaignErrorEnvelope({
      error_code: "VALIDATION_ERROR",
      message: error.message,
    }))
  }
  if (error instanceof ReferenceManifestError) {
    return jsonResearchResult(campaignErrorEnvelope({
      error_code: "SOURCE_ERROR",
      message: error.message,
    }))
  }
  if (error instanceof Error) {
    return jsonResearchResult(campaignErrorEnvelope({
      error_code: "SUBAGENT_FAILED",
      message: error.message,
    }))
  }
  return jsonResearchResult(campaignErrorEnvelope({
    error_code: "SUBAGENT_FAILED",
    message: "Research campaign operation failed",
  }))
}
