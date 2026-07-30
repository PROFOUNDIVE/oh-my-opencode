import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import type { OpenMathSessionState } from "./types"

const OPENMATH_STATE_DIR = ".sisyphus/openmath-state"
const OPENMATH_STATE_FILENAME_MODE_LINUX = "linux"

export type OpenMathStateFilenameMode = "linux" | "windows"

const WINDOWS_FORBIDDEN_FILENAME_CHARS = /[<>:"/\\|?*%\u0000-\u001F]/g

export function getOpenMathStateDirectory(directory: string): string {
  return join(directory, OPENMATH_STATE_DIR)
}

function getOpenMathStateFileName(sessionId: string, mode: OpenMathStateFilenameMode): string {
  if (mode === "windows") {
    return sessionId.replace(WINDOWS_FORBIDDEN_FILENAME_CHARS, (ch) => {
      const codePoint = ch.codePointAt(0)
      if (codePoint === undefined) {
        return "_"
      }
      return `_x${codePoint.toString(16).toUpperCase()}_`
    })
  }
  return sessionId
}

function getLegacyWindowsFileName(sessionId: string): string {
  return encodeURIComponent(sessionId)
}

function getOpenMathStateFilePathByMode(
  directory: string,
  sessionId: string,
  mode: OpenMathStateFilenameMode,
): string {
  return join(getOpenMathStateDirectory(directory), `${getOpenMathStateFileName(sessionId, mode)}.json`)
}

export function getOpenMathStateFilePath(
  directory: string,
  sessionId: string,
  mode: OpenMathStateFilenameMode = OPENMATH_STATE_FILENAME_MODE_LINUX,
): string {
  return getOpenMathStateFilePathByMode(directory, sessionId, mode)
}

function getOpenMathStateFilePathCandidates(
  directory: string,
  sessionId: string,
  mode: OpenMathStateFilenameMode,
): string[] {
  const preferred = getOpenMathStateFilePathByMode(directory, sessionId, mode)
  const fallbackMode = mode === "windows" ? "linux" : "windows"
  const fallback = getOpenMathStateFilePathByMode(directory, sessionId, fallbackMode)
  const legacyWindows = join(getOpenMathStateDirectory(directory), `${getLegacyWindowsFileName(sessionId)}.json`)
  const seen = new Set<string>()
  const candidates: string[] = []
  for (const candidate of [preferred, fallback, legacyWindows]) {
    if (!seen.has(candidate)) {
      seen.add(candidate)
      candidates.push(candidate)
    }
  }
  return candidates
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

  if (parsed.original_problem_text !== undefined && typeof parsed.original_problem_text !== "string") {
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
    ...(parsed.original_problem_text !== undefined
      ? { original_problem_text: parsed.original_problem_text }
      : {}),
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

export function readOpenMathSessionState(
  directory: string,
  sessionId: string,
  mode: OpenMathStateFilenameMode = OPENMATH_STATE_FILENAME_MODE_LINUX,
): OpenMathSessionState | null {
  const filePathCandidates = getOpenMathStateFilePathCandidates(directory, sessionId, mode)
  for (const filePath of filePathCandidates) {
    if (!existsSync(filePath)) {
      continue
    }

    try {
      const content = readFileSync(filePath, "utf-8")
      return parseOpenMathSessionState(content)
    } catch {
      return null
    }
  }

  return null
}

export function readOpenMathSessionStateBytes(
  directory: string,
  sessionId: string,
  mode: OpenMathStateFilenameMode = OPENMATH_STATE_FILENAME_MODE_LINUX,
): Uint8Array | null {
  for (const filePath of getOpenMathStateFilePathCandidates(directory, sessionId, mode)) {
    if (!existsSync(filePath)) continue
    try {
      return readFileSync(filePath)
    } catch {
      return null
    }
  }
  return null
}

export function writeOpenMathSessionState(
  directory: string,
  state: OpenMathSessionState,
  mode: OpenMathStateFilenameMode = OPENMATH_STATE_FILENAME_MODE_LINUX,
): boolean {
  const writeToPath = (filePath: string): boolean => {
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

  const filePath = getOpenMathStateFilePath(directory, state.session_id, mode)
  if (writeToPath(filePath)) {
    return true
  }

  const fallbackPath = getOpenMathStateFilePath(
    directory,
    state.session_id,
    mode === "windows" ? "linux" : "windows",
  )
  return fallbackPath !== filePath ? writeToPath(fallbackPath) : false
}
