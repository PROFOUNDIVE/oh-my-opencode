import { z } from "zod"

import type { ReferenceSnapshot } from "../../references/types"
import type { WorkflowRequestSnapshot, WorkflowStateV1 } from "../../workflow/state"

const ProblemObjectiveContentSchema = z.object({
  kind: z.literal("problem"),
  problem_text: z.string(),
  subject: z.string().optional(),
  chapter_context: z.string().optional(),
  textbook_markdown: z.string().optional(),
  supplementary_refs: z.array(z.string()).readonly().optional(),
}).strict().readonly()

const MarkdownObjectiveContentSchema = z.object({
  kind: z.literal("markdown"),
  instruction: z.string(),
}).strict().readonly()

export const BlindScreenInputSchema = z.object({
  objective: z.discriminatedUnion("kind", [
    ProblemObjectiveContentSchema,
    MarkdownObjectiveContentSchema,
  ]).readonly(),
  reference_contents: z.array(z.string()).readonly(),
  target_artifact: z.object({ content: z.string() }).strict().readonly(),
  screening_instructions: z.string(),
}).strict().readonly()

export type BlindScreenInput = z.infer<typeof BlindScreenInputSchema>

export type BuildBlindScreenInput = Readonly<{
  readonly objective: WorkflowRequestSnapshot
  readonly references: ReferenceSnapshot
  readonly target_artifact: NonNullable<WorkflowStateV1["artifact"]>
  readonly screening_instructions: string
}>

export function buildBlindScreenInput(input: BuildBlindScreenInput): BlindScreenInput {
  return BlindScreenInputSchema.parse({
    objective: objectiveContent(input.objective),
    reference_contents: input.references.references.map((reference) => reference.content),
    target_artifact: { content: input.target_artifact.content },
    screening_instructions: input.screening_instructions,
  })
}

function objectiveContent(objective: WorkflowRequestSnapshot): BlindScreenInput["objective"] {
  switch (objective.kind) {
    case "problem":
      return {
        kind: "problem",
        problem_text: objective.problem_text,
        ...(objective.subject === undefined ? {} : { subject: objective.subject }),
        ...(objective.chapter_context === undefined ? {} : { chapter_context: objective.chapter_context }),
        ...(objective.textbook_markdown === undefined ? {} : { textbook_markdown: objective.textbook_markdown }),
        ...(objective.supplementary_refs === undefined ? {} : { supplementary_refs: objective.supplementary_refs }),
      }
    case "markdown":
      return { kind: "markdown", instruction: objective.instruction }
    default:
      return assertNever(objective)
  }
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected workflow request snapshot: ${String(value)}`)
}
