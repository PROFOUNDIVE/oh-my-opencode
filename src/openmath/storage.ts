import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import type { OpenMathSessionState } from "./types"

const OPENMATH_STATE_DIR = ".sisyphus/openmath-state"

export function getOpenMathStateDirectory(directory: string): string {
  return join(directory, OPENMATH_STATE_DIR)
}

export function getOpenMathStateFilePath(directory: string, sessionId: string): string {
  return join(getOpenMathStateDirectory(directory), `${sessionId}.json`)
}

function isStateObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function isFrozenArtifactsOrNull(value: unknown): value is OpenMathSessionState["frozen_artifacts"] {
  if (value === null) {
    return true
  }

  return isStateObject(value)
}

function parseOpenMathSessionState(content: string): OpenMathSessionState | null {
  const parsed: unknown = JSON.parse(content)
  if (!isStateObject(parsed)) {
    return null
  }

  if (typeof parsed.session_id !== "string") {
    return null
  }

  if (
    parsed.artifact_state !== "DRAFT" &&
    parsed.artifact_state !== "FROZEN" &&
    parsed.artifact_state !== "UNFROZEN"
  ) {
    return null
  }

  if (typeof parsed.artifact_version !== "number" || typeof parsed.review_round !== "number") {
    return null
  }

  if (typeof parsed.max_review_rounds !== "number") {
    return null
  }

  if (!isStateObject(parsed.hint_budget_state)) {
    return null
  }

  if (
    typeof parsed.hint_budget_state.hints_used !== "number" ||
    typeof parsed.hint_budget_state.hint_budget !== "number"
  ) {
    return null
  }

  if (!isFrozenArtifactsOrNull(parsed.frozen_artifacts)) {
    return null
  }

  return {
    session_id: parsed.session_id,
    artifact_state: parsed.artifact_state,
    artifact_version: parsed.artifact_version,
    review_round: parsed.review_round,
    max_review_rounds: parsed.max_review_rounds,
    hint_budget_state: {
      hints_used: parsed.hint_budget_state.hints_used,
      hint_budget: parsed.hint_budget_state.hint_budget,
    },
    frozen_artifacts: parsed.frozen_artifacts,
  }
}

export function readOpenMathSessionState(directory: string, sessionId: string): OpenMathSessionState | null {
  const filePath = getOpenMathStateFilePath(directory, sessionId)
  if (!existsSync(filePath)) {
    return null
  }

  try {
    const content = readFileSync(filePath, "utf-8")
    return parseOpenMathSessionState(content)
  } catch {
    return null
  }
}

export function writeOpenMathSessionState(directory: string, state: OpenMathSessionState): boolean {
  const filePath = getOpenMathStateFilePath(directory, state.session_id)

  try {
    const parentDir = dirname(filePath)
    if (!existsSync(parentDir)) {
      mkdirSync(parentDir, { recursive: true })
    }

    writeFileSync(filePath, JSON.stringify(state, null, 2), "utf-8")
    return true
  } catch {
    return false
  }
}
