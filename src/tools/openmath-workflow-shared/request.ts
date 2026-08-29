import { createHash } from "node:crypto"
import { z } from "zod"

import { resolveProblemRefToProblemText } from "../openmath-solve-only/problem-ref"
import { WorkflowRequestSnapshotSchema, type WorkflowRequestSnapshot } from "../../openmath/workflow/state"

export { serializeWorkflowInputSnapshot as workflowInputFromSnapshot } from "../../openmath/workflow/application/serialize-workflow-input-snapshot"

const NonBlankSchema = z.string().refine((value) => value.trim().length > 0)
const ProblemRequestSchema = z.object({
  kind: z.literal("problem"),
  source: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("text"), text: NonBlankSchema }).strict(),
    z.object({ kind: z.literal("file"), file_path: NonBlankSchema, problem_number: z.number().int().positive() }).strict(),
  ]),
  subject: z.string().optional(),
  chapter_context: z.string().optional(),
  textbook_markdown: z.string().optional(),
  supplementary_refs: z.array(z.string()).optional(),
}).strict()
const MarkdownRequestSchema = z.object({
  kind: z.literal("markdown"),
  instruction: NonBlankSchema,
  initial_artifact: NonBlankSchema.optional(),
}).strict()

export const WorkflowRequestV1Schema = z.discriminatedUnion("kind", [ProblemRequestSchema, MarkdownRequestSchema])
export type WorkflowRequestV1 = z.infer<typeof WorkflowRequestV1Schema>

export async function resolveWorkflowRequest(
  request: WorkflowRequestV1,
  directory: string,
): Promise<Readonly<{ readonly snapshot: WorkflowRequestSnapshot; readonly initial_artifact: { readonly version: 1; readonly media_type: "text/markdown"; readonly content: string; readonly sha256: string } | undefined }>> {
  switch (request.kind) {
    case "problem":
      return resolveProblemRequest(request, directory)
    case "markdown":
      return {
        snapshot: WorkflowRequestSnapshotSchema.parse({ kind: "markdown", instruction: request.instruction }),
        initial_artifact: request.initial_artifact === undefined ? undefined : markdownArtifact(request.initial_artifact),
      }
    default:
      return assertNever(request)
  }
}

async function resolveProblemRequest(
  request: z.infer<typeof ProblemRequestSchema>,
  directory: string,
): Promise<Readonly<{ readonly snapshot: WorkflowRequestSnapshot; readonly initial_artifact: undefined }>> {
  switch (request.source.kind) {
    case "text":
      return { snapshot: WorkflowRequestSnapshotSchema.parse({ ...request, problem_text: request.source.text }), initial_artifact: undefined }
    case "file": {
      const resolved = await resolveProblemRefToProblemText({ projectDir: directory, problemRef: request.source })
      return {
        snapshot: WorkflowRequestSnapshotSchema.parse({
          ...request,
          source: { ...request.source, resolved_path: resolved.resolved_path },
          problem_text: resolved.problem,
        }),
        initial_artifact: undefined,
      }
    }
    default:
      return assertNever(request.source)
  }
}

function markdownArtifact(content: string): { readonly version: 1; readonly media_type: "text/markdown"; readonly content: string; readonly sha256: string } {
  return { version: 1, media_type: "text/markdown", content, sha256: createHash("sha256").update(Buffer.from(content, "utf8")).digest("hex") }
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected workflow request: ${String(value)}`)
}
