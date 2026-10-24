import * as p from '@clack/prompts'

import { openCodeV2ModelSchema } from '@/schema/opencode-v2'

import { ROLES } from './agent-preferences'

import type { AgentName } from '@/core/materializer/agent-restrictions'
import type { OpenCodeV2AgentModelChoice, Provider } from '@/types'

/** No static model catalog: references belong to the user's connected OpenCode providers. */
export async function promptOpenCodeV2AgentModels(provider: Provider, roles: AgentName[] = ROLES, text: (options: Parameters<typeof p.text>[0]) => Promise<string | symbol | undefined> = p.text): Promise<Partial<Record<AgentName, OpenCodeV2AgentModelChoice>>> {
  const choices: Partial<Record<AgentName, OpenCodeV2AgentModelChoice>> = {}
  if (provider !== 'opencode-v2') return choices
  p.log.info('Use a model reference available in OpenCode V2 (provider/model#variant), or inherit.')
  for (const role of roles) {
    const value = await text({ message: `OpenCode V2 model for ${role} (blank = inherit)`, validate: text => !text?.trim() || text.trim() === 'inherit' || openCodeV2ModelSchema.safeParse(text).success ? undefined : 'Use provider/model or provider/model#variant' })
    if (p.isCancel(value)) { p.cancel('Cancelled.'); process.exit(0) }
    const model = (value ?? '').trim()
    choices[role] = !model || model === 'inherit' ? {} : { model: openCodeV2ModelSchema.parse(model) }
  }
  return choices
}
