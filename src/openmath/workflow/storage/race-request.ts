import { z } from "zod"

import { WorkflowStateV1Schema } from "../state"

export const StorageRaceRequestSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("start"),
    directory: z.string(),
    state: WorkflowStateV1Schema,
  }).strict(),
  z.object({
    operation: z.literal("cas"),
    directory: z.string(),
    run_id: z.string(),
    expected_state_revision: z.number().int().nonnegative(),
    next_state: WorkflowStateV1Schema,
  }).strict(),
])

export type StorageRaceRequest = z.infer<typeof StorageRaceRequestSchema>
