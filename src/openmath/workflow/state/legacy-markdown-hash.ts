import { z } from "zod"

export const LegacyMarkdownHashSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/)

export type LegacyMarkdownHash = z.infer<typeof LegacyMarkdownHashSchema>
