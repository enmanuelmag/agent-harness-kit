import type { Provider } from '@/types'

export interface ResearchCapabilities {
  context7: boolean
  mintlifyIndex: boolean
  webSearch: boolean
}

const capabilities: Record<Provider, ResearchCapabilities> = {
  'claude-code': { context7: true, mintlifyIndex: false, webSearch: true },
  opencode: { context7: true, mintlifyIndex: true, webSearch: true },
  'codex-cli': { context7: true, mintlifyIndex: false, webSearch: true },
  'grok-cli': { context7: true, mintlifyIndex: false, webSearch: true },
}

export function getResearchCapabilities(provider: Provider): ResearchCapabilities {
  return capabilities[provider]
}

export function buildCapabilityHints(provider: Provider): string {
  const caps = getResearchCapabilities(provider)
  const hints: string[] = []

  if (caps.context7) {
    hints.push('- Context7 MCP tools available: resolve library ID before querying docs')
  } else {
    hints.push('- Context7 MCP tools NOT available — use official web documentation')
  }

  if (caps.mintlifyIndex) {
    hints.push('- Mintlify Index available for publisher-maintained technical documentation')
  } else {
    hints.push('- Mintlify Index NOT available — fall back to official web documentation')
  }

  if (caps.webSearch) {
    hints.push('- Web search available for current information outside documentation indexes')
  } else {
    hints.push(
      '- Web search NOT available — report proof boundary, do not describe remembered behavior as current'
    )
  }

  return hints.join('\n')
}
