import { afterEach, describe, expect, mock, test } from "bun:test"

import { fetchNpmDistTags, getPluginNameWithVersion } from "./config-manager"

describe("getPluginNameWithVersion", () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test("returns @latest when current version matches latest tag", async () => {
    globalThis.fetch = mock(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ latest: "2.14.0", beta: "3.0.0-beta.3" }) } as Response)) as unknown as typeof fetch
    expect(await getPluginNameWithVersion("2.14.0")).toBe("oh-my-openmath@latest")
  })

  test("returns @beta when current version matches beta tag", async () => {
    globalThis.fetch = mock(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ latest: "2.14.0", beta: "3.0.0-beta.3" }) } as Response)) as unknown as typeof fetch
    expect(await getPluginNameWithVersion("3.0.0-beta.3")).toBe("oh-my-openmath@beta")
  })

  test("returns @next when current version matches next tag", async () => {
    globalThis.fetch = mock(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ latest: "2.14.0", beta: "3.0.0-beta.3", next: "3.1.0-next.1" }) } as Response)) as unknown as typeof fetch
    expect(await getPluginNameWithVersion("3.1.0-next.1")).toBe("oh-my-openmath@next")
  })

  test("returns pinned version when no tag matches", async () => {
    globalThis.fetch = mock(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ latest: "2.14.0", beta: "3.0.0-beta.3" }) } as Response)) as unknown as typeof fetch
    expect(await getPluginNameWithVersion("3.0.0-beta.2")).toBe("oh-my-openmath@3.0.0-beta.2")
  })

  test("returns pinned version when fetch fails", async () => {
    globalThis.fetch = mock(() => Promise.reject(new Error("Network error"))) as unknown as typeof fetch
    expect(await getPluginNameWithVersion("3.0.0-beta.3")).toBe("oh-my-openmath@3.0.0-beta.3")
  })

  test("returns pinned version when npm returns non-ok response", async () => {
    globalThis.fetch = mock(() => Promise.resolve({ ok: false, status: 404 } as Response)) as unknown as typeof fetch
    expect(await getPluginNameWithVersion("2.14.0")).toBe("oh-my-openmath@2.14.0")
  })

  test("prioritizes latest over other tags when version matches multiple", async () => {
    globalThis.fetch = mock(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ beta: "3.0.0", latest: "3.0.0", next: "3.1.0-alpha.1" }) } as Response)) as unknown as typeof fetch
    expect(await getPluginNameWithVersion("3.0.0")).toBe("oh-my-openmath@latest")
  })
})

describe("fetchNpmDistTags", () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test("returns dist-tags on success", async () => {
    globalThis.fetch = mock(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ latest: "2.14.0", beta: "3.0.0-beta.3" }) } as Response)) as unknown as typeof fetch
    expect(await fetchNpmDistTags("oh-my-opencode")).toEqual({ latest: "2.14.0", beta: "3.0.0-beta.3" })
  })

  test("returns null on network failure", async () => {
    globalThis.fetch = mock(() => Promise.reject(new Error("Network error"))) as unknown as typeof fetch
    expect(await fetchNpmDistTags("oh-my-opencode")).toBeNull()
  })

  test("returns null on non-ok response", async () => {
    globalThis.fetch = mock(() => Promise.resolve({ ok: false, status: 404 } as Response)) as unknown as typeof fetch
    expect(await fetchNpmDistTags("oh-my-opencode")).toBeNull()
  })
})
