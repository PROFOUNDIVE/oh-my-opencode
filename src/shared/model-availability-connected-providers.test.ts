import { describe, expect, it } from "bun:test"

import { getConnectedProviders } from "./model-availability"

describe("getConnectedProviders", () => {
  it("should return connected providers from SDK", async () => { expect(await getConnectedProviders({ provider: { list: async () => ({ data: { connected: ["anthropic", "opencode", "google"] } }) } })).toEqual(["anthropic", "opencode", "google"]) })
  it("should return empty array on SDK error", async () => { expect(await getConnectedProviders({ provider: { list: async () => { throw new Error("Network error") } } })).toEqual([]) })
  it("should return empty array when no providers connected", async () => { expect(await getConnectedProviders({ provider: { list: async () => ({ data: { connected: [] } }) } })).toEqual([]) })
  it("should return empty array when client.provider.list not available", async () => { expect(await getConnectedProviders({})).toEqual([]) })
  it("should return empty array for null client", async () => { expect(await getConnectedProviders(null)).toEqual([]) })
  it("should return empty array when data.connected is undefined", async () => { expect(await getConnectedProviders({ provider: { list: async () => ({ data: {} }) } })).toEqual([]) })
})
