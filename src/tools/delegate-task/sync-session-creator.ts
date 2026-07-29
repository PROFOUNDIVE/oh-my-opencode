import type { OpencodeClient } from "./types"
import type { SessionCreateData } from "@opencode-ai/sdk"

export async function createSyncSession(
  client: OpencodeClient,
  input: { parentSessionID: string; agentToUse: string; description: string; defaultDirectory: string; title?: string }
): Promise<{ ok: true; sessionID: string; parentDirectory: string } | { ok: false; error: string }> {
  const parentSession = await client.session.get({ path: { id: input.parentSessionID } })
  const parentDirectory = parentSession.data?.directory ?? input.defaultDirectory
  const request: Omit<SessionCreateData, "url"> = {
    body: {
      parentID: input.parentSessionID,
      title: input.title ?? `${input.description} (@${input.agentToUse} subagent)`,
    },
    query: { directory: parentDirectory },
  }

  const createResult = await client.session.create(request)

  if (createResult.error) {
    return { ok: false, error: `Failed to create session: ${createResult.error}` }
  }

  return { ok: true, sessionID: createResult.data.id, parentDirectory }
}
