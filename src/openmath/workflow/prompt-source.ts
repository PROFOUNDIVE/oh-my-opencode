import { z } from "zod"

const NonBlankStringSchema = z.string().refine((value) => value.trim().length > 0, {
  message: "Prompt content must not be blank",
})

const BuiltinPromptSourceSchema = z.object({
  kind: z.literal("builtin"),
}).strict()

const InlinePromptSourceSchema = z.object({
  kind: z.literal("inline"),
  content: NonBlankStringSchema,
}).strict()

const FilePromptSourceSchema = z.object({
  kind: z.literal("file"),
  uri: z.string().refine((value) => value.startsWith("file://"), {
    message: "File prompt sources require a file:// URI",
  }),
}).strict()

export const PromptSourceSchema = z.discriminatedUnion("kind", [
  BuiltinPromptSourceSchema,
  InlinePromptSourceSchema,
  FilePromptSourceSchema,
])

export type PromptSource = z.infer<typeof PromptSourceSchema>

export type WorkflowFilePromptProvenance = {
  readonly original_uri: string
  readonly base_dir: string
  readonly resolved_path: string
  readonly canonical_path: string
  readonly content: string
  readonly content_hash: string
}

const workflowPromptProvenance = new WeakMap<object, WorkflowFilePromptProvenance>()

export function setWorkflowFilePromptProvenance(
  role: object,
  provenance: WorkflowFilePromptProvenance,
): void {
  workflowPromptProvenance.set(role, provenance)
}

export function getWorkflowFilePromptProvenance(
  role: object | undefined,
): WorkflowFilePromptProvenance | undefined {
  return role ? workflowPromptProvenance.get(role) : undefined
}
