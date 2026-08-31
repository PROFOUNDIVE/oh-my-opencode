import { OpenMathConfigSchema } from "../../../config/schema"
import { createOpenMathResearchTools } from "../../../tools/openmath-research-tools"
import { researchToolConfig, researchToolContext } from "../../../tools/openmath-research-test-support"
import {
  EnabledCampaignErrorEnvelopeSchema,
  EnabledCampaignSuccessEnvelopeSchema,
  type EnabledCampaignSuccessEnvelope,
} from "../application"
import { CoverageInputSchema } from "../certification/adapters/coverage-input"
import { ExtractionInputSchema } from "../certification/adapters/extraction-input"
import { CertificationGraphSchema } from "../certification/state/graph"
import type { CertificationContext } from "../certification/application/certification-application-types"
import type { ResearchCertificationStateV1 } from "../certification/state/schema"
import { z } from "zod"

const ExtractionRoundPromptSchema = z.object({
  extraction: ExtractionInputSchema,
  prior_graph: CertificationGraphSchema.nullable(),
  prior_findings: z.array(z.unknown()).readonly(),
  amendments: z.array(z.unknown()).readonly(),
}).strict().readonly()

export function enabledCertificationConfig() {
  const base = researchToolConfig()
  const profile = base.research_profiles?.["phase-a"]
  if (profile === undefined) throw new TypeError("Phase A profile is unavailable")
  const role = (agent: string) => ({ agent, model: "openai/gpt-5", prompt: { kind: "inline" as const, content: `${agent} prompt` } })
  return OpenMathConfigSchema.parse({
    ...base,
    research_profiles: { "phase-a": { ...profile, survivor_limit: 2, max_active_candidates: 2, certification: {
      schema_version: 1,
      extraction_role: role("extractor"),
      coverage_role: role("coverage-reviewer"),
      counterexample_role: role("attacker"),
      witness_role: role("witness-reviewer"),
      max_obligations: 8,
      max_coverage_rounds: 2,
      max_coverage_findings: 8,
      allowed_attack_modes: ["EDGE_CASE"],
      max_attacks_per_obligation: 1,
      max_active_certification_jobs: 2,
    } } },
  })
}

export async function nextCertificationStep(
  tools: () => ReturnType<typeof createOpenMathResearchTools>,
  context: ReturnType<typeof researchToolContext>,
  current: EnabledCampaignSuccessEnvelope,
) {
  return parsePublicResponse(await tools().openmath_research_step.execute({
    campaign_id: current.campaign_id,
    expected_state_revision: current.state_revision,
    expected_certification_revision: requiredCertificationRevision(current),
    mode: "one_stage",
  }, context))
}

export function requiredCertificationRevision(response: EnabledCampaignSuccessEnvelope): number {
  const revision = response.certification.certification_revision
  if (revision === null) throw new TypeError(`Missing certification revision: ${JSON.stringify(response)}`)
  return revision
}

export function parsePublicResponse(value: unknown): EnabledCampaignSuccessEnvelope {
  const decoded: unknown = JSON.parse(String(value))
  return EnabledCampaignSuccessEnvelopeSchema.parse(decoded)
}

export function parsePublicError(value: unknown) {
  const decoded: unknown = JSON.parse(String(value))
  return EnabledCampaignErrorEnvelopeSchema.parse(decoded)
}

export function parseExtractionRoundPrompt(value: string) {
  const decoded: unknown = JSON.parse(value)
  return ExtractionRoundPromptSchema.parse(decoded)
}

export function parseCoverageRoundPrompt(value: string) {
  const decoded: unknown = JSON.parse(value)
  return CoverageInputSchema.parse(decoded)
}

export function expectedExtractionRoundPrompt(context: CertificationContext, state: ResearchCertificationStateV1) {
  const artifact = requiredArtifact(context)
  return {
    extraction: {
      artifact: { media_type: artifact.media_type, content: artifact.content },
      objective: { source_id: "objective" as const, content: JSON.stringify(context.sources.objective) },
      references: context.sources.references.references.map((reference) => ({ source_id: reference.id, content: reference.content })),
    },
    prior_graph: state.graphs[0],
    prior_findings: state.coverage_reviews[0]?.findings,
    amendments: [],
  }
}

export function expectedCoverageRoundPrompt(context: CertificationContext, state: ResearchCertificationStateV1) {
  const artifact = requiredArtifact(context)
  return {
    artifact: { media_type: artifact.media_type, content: artifact.content },
    graph: state.graphs[1],
    max_findings: context.profile.max_coverage_findings,
  }
}

function requiredArtifact(context: CertificationContext) {
  const artifact = context.child.artifact
  if (artifact === null) throw new TypeError("Certification artifact is unavailable")
  return artifact
}
