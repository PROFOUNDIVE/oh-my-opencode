export class StagePersistenceError extends Error {
  readonly name = "StagePersistenceError"

  constructor(
    readonly error_code: string,
    message: string,
  ) {
    super(message)
  }
}
