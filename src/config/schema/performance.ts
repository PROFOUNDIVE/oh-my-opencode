import { z } from "zod"

const DelegateTaskTimingConfigSchema = z
  .object({
    POLL_INTERVAL_MS: z.number().min(250).optional(),
    MIN_STABILITY_TIME_MS: z.number().min(1000).optional(),
    STABILITY_POLLS_REQUIRED: z.number().int().min(1).optional(),
    WAIT_FOR_SESSION_INTERVAL_MS: z.number().min(1).optional(),
    WAIT_FOR_SESSION_TIMEOUT_MS: z.number().min(1).optional(),
    MAX_POLL_TIME_MS: z.number().min(1).optional(),
    SESSION_CONTINUATION_STABILITY_MS: z.number().min(0).optional(),
  })
  .optional()

const BackgroundAgentPollingConfigSchema = z
  .object({
    pollingIntervalMs: z.number().min(250).optional(),
    minStabilityTimeMs: z.number().min(1000).optional(),
    minIdleTimeMs: z.number().min(250).optional(),
  })
  .optional()

export const PerformanceConfigSchema = z.object({
  delegate_task_timing: DelegateTaskTimingConfigSchema,
  background_agent_polling: BackgroundAgentPollingConfigSchema,
})

export type PerformanceConfig = z.infer<typeof PerformanceConfigSchema>
