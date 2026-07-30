import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"

type CachedModel = { readonly id?: string }
type CachedProvider = { readonly id?: string; readonly models?: Record<string, CachedModel> }
type ProviderModel = string | { readonly id?: string; readonly provider?: string; readonly context?: number; readonly output?: number } | null

export type ModelsCache = Record<string, CachedProvider>
export type ProviderModelsCache = { readonly models: Record<string, readonly ProviderModel[]>; readonly connected: readonly string[] }

export interface ModelCacheFixture {
  readonly tempDir: string
  writeModelsCache(data: ModelsCache): void
  writeProviderModelsCache(data: ProviderModelsCache): void
  writeConnectedProvidersCache(connected: readonly string[]): void
  cleanup(): void
}

export function createModelCacheFixture(): ModelCacheFixture {
  const tempDir = mkdtempSync(join(tmpdir(), "opencode-test-"))
  const writeCache = (directory: string, fileName: string, data: unknown): void => {
    const cacheDir = join(tempDir, directory)
    mkdirSync(cacheDir, { recursive: true })
    writeFileSync(join(cacheDir, fileName), JSON.stringify(data))
  }

  return {
    tempDir,
    writeModelsCache: (data) => writeCache("opencode", "models.json", data),
    writeProviderModelsCache: (data) => writeCache("oh-my-openmath", "provider-models.json", { ...data, updatedAt: new Date().toISOString() }),
    writeConnectedProvidersCache: (connected) => writeCache("oh-my-openmath", "connected-providers.json", { connected, updatedAt: new Date().toISOString() }),
    cleanup: () => rmSync(tempDir, { recursive: true, force: true }),
  }
}
