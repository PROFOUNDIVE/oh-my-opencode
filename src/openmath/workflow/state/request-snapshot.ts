import { z } from "zod"

const NonBlankSchema = z.string().refine((value) => value.trim().length > 0)

export const WorkflowRequestSnapshotSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("problem"),
    source: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("text"), text: NonBlankSchema }).strict(),
      z.object({
        kind: z.literal("file"),
        file_path: NonBlankSchema,
        problem_number: z.number().int().positive(),
        resolved_path: NonBlankSchema,
      }).strict(),
    ]),
    problem_text: NonBlankSchema,
    subject: z.string().optional(),
    chapter_context: z.string().optional(),
    textbook_markdown: z.string().optional(),
    supplementary_refs: z.array(z.string()).optional(),
  }).strict(),
  z.object({
    kind: z.literal("markdown"),
    instruction: NonBlankSchema,
  }).strict(),
])

export type WorkflowRequestSnapshot = z.infer<typeof WorkflowRequestSnapshotSchema>
