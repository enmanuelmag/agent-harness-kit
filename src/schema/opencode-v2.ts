import { z } from 'zod'

/** Native references include an optional variant; inheritance is explicit in saved preferences. */
export const openCodeV2ModelSchema = z.string().trim().regex(/^[^/\s#\"']+\/[^\s#\"']+(?:#[^\s#\"']+)?$/, 'Use provider/model or provider/model#variant')
export const openCodeV2ChoiceSchema = z.object({ model: openCodeV2ModelSchema.optional() }).strict()
export const openCodeV2PreferenceSchema = z.object({ model: z.union([z.literal('inherit'), openCodeV2ModelSchema]) }).strict()
export type OpenCodeV2AgentModelChoice = z.infer<typeof openCodeV2ChoiceSchema>

export const openCodeV2DiagnosticSchema = z.object({
  configPath: z.string().optional(),
  issues: z.array(z.string()),
  runtimeVersion: z.string().optional(),
  runtimeVerified: z.literal(false),
})
export type OpenCodeV2Diagnostic = z.infer<typeof openCodeV2DiagnosticSchema>
