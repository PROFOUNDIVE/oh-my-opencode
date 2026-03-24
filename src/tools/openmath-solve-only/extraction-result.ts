export type ExtractionStage =
  | "strip"
  | "candidate_scan"
  | "parse"
  | "schema"

export type ExtractionSuccess<T> = {
  ok: true
  value: T
  attempts: number
  selected_candidate_index: number
}

export type ExtractionFailure = {
  ok: false
  stage: ExtractionStage
  error_code: string
  attempts: number
  message: string
}

export type ExtractionResult<T> = ExtractionSuccess<T> | ExtractionFailure

export function createExtractionSuccess<T>(
  value: T,
  attempts: number,
  selected_candidate_index: number,
): ExtractionSuccess<T> {
  return {
    ok: true,
    value,
    attempts,
    selected_candidate_index,
  }
}

export function createExtractionFailure(
  stage: ExtractionStage,
  error_code: string,
  attempts: number,
  message: string,
): ExtractionFailure {
  return {
    ok: false,
    stage,
    error_code,
    attempts,
    message,
  }
}
