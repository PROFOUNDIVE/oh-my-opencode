import { applyOpenMathArtifactsPatch } from "../../artifacts-patch/apply"
import { OpenMathArtifactsPatchSetSchema } from "../../artifacts-patch/types"
import { extractSchemaValidatedJsonCandidate } from "../../../tools/openmath-solve-only/json-candidate-extractor"
import type { AdapterResult, PatchAdapterOptions } from "./types"

export function adaptPatchSet(input: {
  readonly rawOutput: string
  readonly baseMarkdown: string
  readonly patchOptions?: PatchAdapterOptions
}): AdapterResult {
  const patchSet = extractSchemaValidatedJsonCandidate({
    text: input.rawOutput,
    validate: (value) => {
      const parsed = OpenMathArtifactsPatchSetSchema.safeParse(value)
      if (parsed.success) return { success: true as const, data: parsed.data }
      return { success: false as const, message: "Patch output does not match OpenMathArtifactsPatchSetSchema" }
    },
  })
  if (!patchSet.ok) {
    if (patchSet.stage === "schema") return invalidPatchSetError(input.rawOutput)
    return invalidJsonError(input.rawOutput)
  }

  const applied = applyOpenMathArtifactsPatch({
    base_markdown: input.baseMarkdown,
    patch_set: patchSet.value,
    opts: input.patchOptions,
  })
  if (!applied.ok) {
    return {
      ok: false,
      error: {
        kind: "adapter_error",
        code: "PATCH_APPLY_FAILED",
        message: `Patch application failed: ${applied.error_code}`,
        raw_output: input.rawOutput,
      },
    }
  }

  return {
    ok: true,
    kind: "markdown_artifact",
    adapter: "patch_set_json",
    artifact: {
      media_type: "text/markdown",
      content: applied.markdown,
      hash: applied.hash,
      draft: applied.draft,
    },
  }
}

function invalidJsonError(rawOutput: string): AdapterResult {
  return {
    ok: false,
    error: {
      kind: "adapter_error",
      code: "INVALID_JSON",
      message: "Patch output is not valid JSON",
      raw_output: rawOutput,
    },
  }
}

function invalidPatchSetError(rawOutput: string): AdapterResult {
  return {
    ok: false,
    error: {
      kind: "adapter_error",
      code: "INVALID_PATCH_SET",
      message: "Patch output does not match OpenMathArtifactsPatchSetSchema",
      raw_output: rawOutput,
    },
  }
}
