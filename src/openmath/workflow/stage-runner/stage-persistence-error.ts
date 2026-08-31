import type { WorkflowErrorCode } from "../state/literals"

export class StagePersistenceError extends Error {
  readonly name = "StagePersistenceError"

  constructor(
    readonly error_code: WorkflowErrorCode,
    message: string,
  ) {
    super(message)
  }
}
