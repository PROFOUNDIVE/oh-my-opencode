import { z } from "zod"

const ResponseLanguageTagSchema = z
  .string()
  .regex(/^[A-Za-z0-9-]{2,35}$/)
  .refine((value) => !/\s/.test(value), {
    message: "response_language must not contain whitespace",
  })

export const LocalizationConfigSchema = z.object({
  response_language: z.union([z.literal("auto"), ResponseLanguageTagSchema]).optional(),
})

export type LocalizationConfig = z.infer<typeof LocalizationConfigSchema>
