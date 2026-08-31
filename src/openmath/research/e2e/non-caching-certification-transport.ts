import { z } from "zod"

import { sha256 } from "../../workflow/stage-runner/sha256"
import type { CertificationRoundRuntimeFactory } from "../certification/orchestration/extraction-coverage-types"
import type { CertificationJobDispatch } from "../certification/scheduler"

const ExtractionPayloadSchema = z.looseObject({
  extraction: z.looseObject({
    artifact: z.looseObject({ content: z.string().min(1) }),
  }),
})

export function createCertificationTransportStore() {
  return {
    children: new Map<string, string>(),
    messages: new Map<string, string>(),
    requests: [] as CertificationJobDispatch[],
    coverage_dispatches: 0,
    instances: 0,
  }
}

export function createNonCachingCertificationTransport(
  store = createCertificationTransportStore(),
) {
  store.instances += 1
  const createRuntime: CertificationRoundRuntimeFactory = (callbacks) => ({
    verify_operation_owner: async () => ({ ok: true }),
    persist_job_attempt: callbacks.persist_job_attempt,
    block_reconciliation: callbacks.block_reconciliation,
    list_children: async () => [...store.children.keys()].map((id) => ({ id })),
    get_session: async (sessionID) => ({ title: store.children.get(sessionID) ?? "unknown" }),
    list_messages: async (sessionID) => {
      const text = store.messages.get(sessionID)
      return text === undefined ? [] : [{ role: "user", text }]
    },
    dispatch: async (request) => dispatch(request),
  })

  return {
    createRuntime,
    snapshot: () => ({
      dispatches: store.requests.length,
      instances: store.instances,
      child_sessions: [...store.children.keys()],
      prompts: [...store.messages.values()],
      requests: store.requests.map((request) => ({
        child_title: request.child_title,
        parent_session_id: request.parent_session_id,
        agent: request.agent_to_use,
        model: request.category_model,
        system_content: request.system_content ?? null,
        prompt_marker: request.prompt_marker,
        send_prompt: request.send_prompt,
        persisted_session_id: request.persisted_session_id ?? null,
        user_prompt: request.user_prompt,
        user_prompt_sha256: sha256(request.user_prompt),
      })),
    }),
  }

  async function dispatch(request: CertificationJobDispatch): Promise<unknown> {
    store.requests.push(request)
    if (request.persisted_session_id !== undefined && !store.children.has(request.persisted_session_id)) {
      return { ok: false, error: `Certification session ${request.persisted_session_id} does not exist` }
    }
    const sessionID = request.persisted_session_id ?? `ses_certification${store.children.size + 1}`
    if (request.persisted_session_id === undefined) {
      store.children.set(sessionID, request.child_title)
      await request.awaited_callbacks.on_session_created?.(sessionID)
    }
    if (request.send_prompt) {
      store.messages.set(sessionID, `${request.prompt_marker}${request.user_prompt}`)
      await request.awaited_callbacks.on_prompt_sent?.(sessionID)
    }
    return { ok: true, session_id: sessionID, text: outputFor(request) }
  }

  function outputFor(request: CertificationJobDispatch): string {
    if (request.agent_to_use === "coverage-reviewer") {
      store.coverage_dispatches += 1
      return JSON.stringify(store.coverage_dispatches === 1
        ? {
            verdict: "REVISE",
            findings: [{
              kind: "MISSING_CLAIM",
              source_span: null,
              obligation_ids: [],
              message: "Extract the omitted claim.",
              suggested_correction: "Repeat extraction with the complete claim set.",
            }],
          }
        : { verdict: "PASS", findings: [] })
    }
    const payload = ExtractionPayloadSchema.parse(JSON.parse(request.user_prompt))
    const content = payload.extraction.artifact.content
    return JSON.stringify({
      assumptions: [],
      nodes: [{
        local_id: "root",
        kind: "THEOREM",
        source_span: { start_byte: 0, end_byte: Buffer.byteLength(content), span_sha256: sha256(content) },
        statement: content,
        prerequisite_local_ids: [],
        assumption_local_ids: [],
        required: true,
      }],
      required_root_local_ids: ["root"],
    })
  }
}
