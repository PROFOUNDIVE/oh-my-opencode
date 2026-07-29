import type {
  AgentOverrideConfig,
  AgentOverrides,
  CategoriesConfig,
  CategoryConfig,
  OhMyOpenCodeConfig,
} from "./schema"
import { decodeFileUri } from "../agents/builtin-agents/file-uri-decoder"
import { resolvePromptAppend } from "../agents/builtin-agents/prompt-append-resolver"
import { resolveReplacementPrompt } from "../agents/builtin-agents/replacement-prompt-resolver"
import {
  getPromptSourceDirectory,
  getPromptSourceMetadata,
  setPromptSourceMetadata,
  type PromptSourceMetadata,
} from "./prompt-source-directories"

const BESPOKE_CATEGORY_AGENTS = new Set(["sisyphus-junior", "prometheus"])

export function resolveFileBackedPromptSources(
  config: OhMyOpenCodeConfig,
): OhMyOpenCodeConfig {
  return {
    ...config,
    ...(config.agents || config.categories
      ? resolveConfigPromptSources(config.agents, config.categories)
      : {}),
  }
}

function resolveConfigPromptSources(
  agents: AgentOverrides | undefined,
  categories: CategoriesConfig | undefined,
): Pick<OhMyOpenCodeConfig, "agents" | "categories"> {
  const resolvedCategories = categories ? resolveCategorySources(categories) : undefined
  const resolvedAgents = agents ? resolveAgentSources(agents, resolvedCategories) : undefined

  return {
    ...(resolvedAgents ? { agents: resolvedAgents } : {}),
    ...(resolvedCategories ? { categories: resolvedCategories } : {}),
  }
}

function resolveAgentSources(
  agents: AgentOverrides,
  categories: CategoriesConfig | undefined,
): AgentOverrides {
  return Object.fromEntries(
    Object.entries(agents).map(([name, override]) => [
      name,
      override ? resolveAgentSource(name, override, categories) : undefined,
    ]),
  )
}

function resolveAgentSource(
  name: string,
  override: AgentOverrideConfig,
  categories: CategoriesConfig | undefined,
): AgentOverrideConfig {
  const prompt = override.prompt
  const promptAppend = override.prompt_append
  const promptBaseDirectory = getPromptSourceDirectory(override, "prompt")
  const promptResult = isFileUri(prompt) ? resolveReplacementPrompt(
    prompt,
    promptBaseDirectory,
  ) : undefined
  const appendResult = isFileUri(promptAppend)
    ? materializeAppend(promptAppend, getPromptSourceDirectory(override, "prompt_append"))
    : undefined
  const category = typeof override.category === "string" ? categories?.[override.category] : undefined
  const categoryAppend = category?.prompt_append
  const categoryMetadata = getPromptSourceMetadata(category, "prompt_append")
  const appendMetadata = appendResult ? [appendResult.metadata] : []
  const isBespoke = BESPOKE_CATEGORY_AGENTS.has(name)
  const combinedAppend = isBespoke && categoryAppend
    ? [categoryAppend, appendResult?.content ?? promptAppend].filter((value): value is string => value !== undefined).join("\n")
    : appendResult?.content ?? promptAppend
  const resolved = {
    ...override,
    ...(promptResult ? { prompt: promptResult.content } : {}),
    ...(combinedAppend !== undefined ? { prompt_append: combinedAppend } : {}),
  }

  if (promptResult) {
    setPromptSourceMetadata(resolved, "prompt", [
      toReplacementMetadata(promptResult, promptBaseDirectory),
    ])
  }
  if (combinedAppend !== undefined) {
    setPromptSourceMetadata(resolved, "prompt_append", isBespoke ? [...categoryMetadata, ...appendMetadata] : appendMetadata)
  }

  return resolved
}

function resolveCategorySources(categories: CategoriesConfig): CategoriesConfig {
  return Object.fromEntries(
    Object.entries(categories).map(([name, category]) => [name, resolveCategorySource(category)]),
  )
}

function resolveCategorySource(category: CategoryConfig): CategoryConfig {
  const promptAppend = category.prompt_append
  if (!isFileUri(promptAppend)) return category

  const append = materializeAppend(promptAppend, getPromptSourceDirectory(category, "prompt_append"))
  const resolved = {
    ...category,
    prompt_append: append.content,
  }
  setPromptSourceMetadata(resolved, "prompt_append", [append.metadata])
  return resolved
}

function materializeAppend(uri: string, baseDirectory: string | undefined): {
  readonly content: string
  readonly metadata: PromptSourceMetadata
} {
  const content = resolvePromptAppend(uri, baseDirectory)
  try {
    const decoded = decodeFileUri(uri, baseDirectory)
    return {
      content,
      metadata: {
        originalUri: uri,
        ...(baseDirectory ? { baseDirectory } : {}),
        resolvedPath: decoded.path,
        content,
      },
    }
  } catch {
    return {
      content,
      metadata: { originalUri: uri, ...(baseDirectory ? { baseDirectory } : {}), content },
    }
  }
}

function toReplacementMetadata(
  result: ReturnType<typeof resolveReplacementPrompt>,
  baseDirectory: string | undefined,
): PromptSourceMetadata {
  return {
    originalUri: result.uri,
    ...(baseDirectory ? { baseDirectory } : {}),
    resolvedPath: result.path,
    canonicalPath: result.canonicalPath,
    content: result.content,
    sha256: result.sha256,
  }
}

function isFileUri(value: string | undefined): value is string {
  return value?.startsWith("file://") ?? false
}
