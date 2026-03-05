import type { FrozenArtifacts } from "../../openmath/types"
import { renderStudentHintLadderMarkdown } from "./hint-ladder-markdown"
import { stripDoubleUnderscoreKeys } from "./strip-double-underscore-keys"

export function renderStudentSolutionMarkdown(artifacts: FrozenArtifacts): string {
  const safeHints = stripDoubleUnderscoreKeys(artifacts.hint_ladder)
  const hintBlock = renderStudentHintLadderMarkdown(safeHints)

  return ["# OpenMath hints (student)", "", hintBlock.trimEnd(), "", ""].join("\n")
}
