import type { Provider } from '@/types'

/** Keep harness role identities stable while projecting provider-native names. */
export function nativeAgentName(provider: string, role: string): string {
  return provider === 'codex-cli' && role === 'lead' ? 'default' : role
}

export function nativeAgentFilename(provider: Provider | string, role: string): string {
  return `${nativeAgentName(provider, role)}${provider === 'codex-cli' ? '.toml' : '.md'}`
}

export const LEGACY_CODEX_LEAD = '.codex/agents/lead.toml'
