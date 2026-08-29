import type {
  ResearchCampaignOperationLockReleaseResult,
  ResearchCampaignWriteLockReleaseResult,
} from "./storage-results"

type ResearchCampaignLockReleaseResult =
  | ResearchCampaignOperationLockReleaseResult
  | ResearchCampaignWriteLockReleaseResult

type ResearchCampaignLockReleaseFailure = Extract<ResearchCampaignLockReleaseResult, { readonly kind: "error" }>

const UNEXPECTED_CLEANUP_FAILURE: ResearchCampaignLockReleaseFailure = {
  kind: "error",
  error_code: "STORAGE_WRITE_FAILED",
  message: "Durable research campaign lock cleanup threw unexpectedly",
}

export class ResearchCampaignLockCleanupError extends Error {
  readonly name = "ResearchCampaignLockCleanupError"

  constructor(
    readonly operation_error: unknown,
    readonly cleanup_failure: ResearchCampaignLockReleaseFailure,
    readonly cleanup_error: unknown | null = null,
  ) {
    const operationMessage = operation_error instanceof Error
      ? operation_error.message
      : "Research campaign operation failed"
    super(`${operationMessage}; durable lock cleanup failed: ${cleanup_failure.message}`, { cause: operation_error })
  }
}

export async function rethrowAfterResearchCampaignLockCleanup(
  operationError: unknown,
  release: () => Promise<ResearchCampaignLockReleaseResult>,
): Promise<never> {
  let released: ResearchCampaignLockReleaseResult
  try {
    released = await release()
  } catch (cleanupError) {
    throw new ResearchCampaignLockCleanupError(operationError, UNEXPECTED_CLEANUP_FAILURE, cleanupError)
  }
  if (released.kind === "error") {
    throw new ResearchCampaignLockCleanupError(operationError, released)
  }
  throw operationError
}
