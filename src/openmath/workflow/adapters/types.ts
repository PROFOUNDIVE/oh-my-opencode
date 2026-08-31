import type { OpenMathArtifactsDraft } from "../../artifacts-markdown/types"
import type { LegacyReviewMetadata } from "../state/contracts"
import type { PatchApplyFailure } from "./patch-apply-failure"

export type PatchAdapterOptions = Readonly<{
  readonly max_ops?: number
  readonly allow_unique_substring_replace?: boolean
}>

export type AdapterInput =
  | Readonly<{ readonly adapter: "legacy_omo_sections"; readonly raw_output: string }>
  | Readonly<{ readonly adapter: "legacy_json_artifacts"; readonly raw_output: string }>
  | Readonly<{ readonly adapter: "opaque_markdown"; readonly raw_output: string }>
  | Readonly<{ readonly adapter: "review_verdict_json"; readonly raw_output: string }>
  | Readonly<{ readonly adapter: "review_verdict_markdown"; readonly raw_output: string }>
  | Readonly<{
      readonly adapter: "patch_set_json"
      readonly raw_output: string
      readonly base_markdown: string
      readonly patch_options?: PatchAdapterOptions
    }>
  | Readonly<{ readonly adapter: "full_replace_markdown"; readonly raw_output: string }>
  | Readonly<{
      readonly adapter: "research_educational_artifacts"
      readonly raw_output: string
      readonly fixed_reference_solution: string
    }>
  | Readonly<{ readonly adapter: "research_educational_review_json"; readonly raw_output: string }>

export type AdapterErrorCode =
  | "EMPTY_MARKDOWN"
  | "INVALID_JSON"
  | "INVALID_LEGACY_ARTIFACTS"
  | "INVALID_LEGACY_SECTIONS"
  | "INVALID_PATCH_SET"
  | "PATCH_APPLY_FAILED"
  | "MISSING_VERDICT"
  | "DUPLICATE_VERDICT"
  | "CONFLICTING_VERDICTS"
  | "INVALID_REVIEW_VERDICT"
  | "INVALID_RESEARCH_EDUCATIONAL_ARTIFACTS"
  | "INVALID_RESEARCH_EDUCATIONAL_REVIEW"
  | "REFERENCE_SOLUTION_MUTATED"

type AdapterErrorFor<Code extends AdapterErrorCode> = Readonly<{
  readonly kind: "adapter_error"
  readonly code: Code
  readonly message: string
  readonly raw_output: string
}>

export type AdapterError =
  | AdapterErrorFor<"EMPTY_MARKDOWN">
  | AdapterErrorFor<"INVALID_JSON">
  | AdapterErrorFor<"INVALID_LEGACY_ARTIFACTS">
  | AdapterErrorFor<"INVALID_LEGACY_SECTIONS">
  | AdapterErrorFor<"INVALID_PATCH_SET">
  | AdapterErrorFor<"PATCH_APPLY_FAILED"> & Readonly<{ readonly patch_failure: PatchApplyFailure }>
  | AdapterErrorFor<"MISSING_VERDICT">
  | AdapterErrorFor<"DUPLICATE_VERDICT">
  | AdapterErrorFor<"CONFLICTING_VERDICTS">
  | AdapterErrorFor<"INVALID_REVIEW_VERDICT">
  | AdapterErrorFor<"INVALID_RESEARCH_EDUCATIONAL_ARTIFACTS">
  | AdapterErrorFor<"INVALID_RESEARCH_EDUCATIONAL_REVIEW">
  | AdapterErrorFor<"REFERENCE_SOLUTION_MUTATED">

export type MarkdownArtifact = Readonly<{
  readonly media_type: "text/markdown"
  readonly content: string
  readonly hash: string
}>

export type LegacyJsonArtifacts = Readonly<{
  readonly reference_solution: string
  readonly hint_ladder: Record<string, unknown>
  readonly grading_rubric: Record<string, unknown>
  readonly variant_problem: string
}>

export type CanonicalReviewVerdict = "PASS" | "REVISE" | "INCONCLUSIVE"

export type AdapterReview = Readonly<{
  readonly verdict: CanonicalReviewVerdict
  readonly raw_report: string
  readonly legacy_metadata?: LegacyReviewMetadata
  readonly source_defect?: boolean
  readonly checks_performed?: readonly string[]
}>

type ParsedMarkdownArtifact = MarkdownArtifact & Readonly<{ readonly draft: OpenMathArtifactsDraft }>

type LegacyOmoSectionsResult = Readonly<{
  readonly ok: true
  readonly kind: "markdown_artifact"
  readonly adapter: "legacy_omo_sections"
  readonly artifact: ParsedMarkdownArtifact
}>

type LegacyJsonArtifactsResult = Readonly<{
  readonly ok: true
  readonly kind: "legacy_json_artifacts"
  readonly adapter: "legacy_json_artifacts" | "research_educational_artifacts"
  readonly artifacts: LegacyJsonArtifacts
}>

type ReplacementMarkdownResult = Readonly<{
  readonly ok: true
  readonly kind: "markdown_artifact"
  readonly adapter: "opaque_markdown" | "full_replace_markdown"
  readonly artifact: MarkdownArtifact
}>

type ReviewResult = Readonly<{
  readonly ok: true
  readonly kind: "review"
  readonly adapter: "review_verdict_json" | "review_verdict_markdown" | "research_educational_review_json"
  readonly review: AdapterReview
}>

type PatchSetResult = Readonly<{
  readonly ok: true
  readonly kind: "markdown_artifact"
  readonly adapter: "patch_set_json"
  readonly artifact: ParsedMarkdownArtifact
}>

export type AdapterSuccess =
  | LegacyOmoSectionsResult
  | LegacyJsonArtifactsResult
  | ReplacementMarkdownResult
  | ReviewResult
  | PatchSetResult

export type AdapterResult = AdapterSuccess | Readonly<{ readonly ok: false; readonly error: AdapterError }>
