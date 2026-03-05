import type { FrozenArtifacts } from "../../openmath/types"
import { renderTeacherRubric } from "./rubric-markdown"
import { stableJson } from "./stable-json"
import { stripDoubleUnderscoreKeys } from "./strip-double-underscore-keys"

export function renderTeacherSolutionMarkdown(artifacts: FrozenArtifacts): string {
  const safeRubric = stripDoubleUnderscoreKeys(artifacts.grading_rubric)
  const rubricBlock = renderTeacherRubric(safeRubric)

  return [
    "# OpenMath solution (teacher)",
    "",
    "## Variant problem",
    "",
    artifacts.variant_problem.trimEnd(),
    "",
    "## Reference solution",
    "",
    "```latex",
    artifacts.reference_solution.trimEnd(),
    "```",
    "",
    rubricBlock.trimEnd(),
    "",
    "## Review certificate",
    "",
    "```json",
    stableJson(artifacts.review_certificate),
    "```",
    "",
  ].join("\n")
}
