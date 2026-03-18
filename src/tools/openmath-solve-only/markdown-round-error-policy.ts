const RETRYABLE_MARKDOWN_ERROR_CODES = new Set([
  "REVIEWER_OUTPUT_INVALID",
  "ARTIFACTS_PARSE_ERROR",
])

export function shouldConsumeReviewBudgetForMarkdownError(errorCode: string): boolean {
  return RETRYABLE_MARKDOWN_ERROR_CODES.has(errorCode)
}
