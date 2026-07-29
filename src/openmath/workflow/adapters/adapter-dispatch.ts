import { adaptLegacyJsonArtifacts, adaptLegacyOmoSections } from "./legacy-artifacts"
import { adaptMarkdownReplacement } from "./markdown-replacement"
import { adaptPatchSet } from "./patch-set"
import { adaptJsonReviewVerdict, adaptMarkdownReviewVerdict } from "./review-verdict"
import type { AdapterInput, AdapterResult } from "./types"

export function adaptWorkflowOutput(input: AdapterInput): AdapterResult {
  switch (input.adapter) {
    case "legacy_omo_sections":
      return adaptLegacyOmoSections(input.raw_output)
    case "legacy_json_artifacts":
      return adaptLegacyJsonArtifacts(input.raw_output)
    case "opaque_markdown":
      return adaptMarkdownReplacement(input.adapter, input.raw_output)
    case "review_verdict_json":
      return adaptJsonReviewVerdict(input.raw_output)
    case "review_verdict_markdown":
      return adaptMarkdownReviewVerdict(input.raw_output)
    case "patch_set_json":
      return adaptPatchSet({
        rawOutput: input.raw_output,
        baseMarkdown: input.base_markdown,
        patchOptions: input.patch_options,
      })
    case "full_replace_markdown":
      return adaptMarkdownReplacement(input.adapter, input.raw_output)
    default:
      return assertNever(input)
  }
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected workflow adapter input: ${String(value)}`)
}
