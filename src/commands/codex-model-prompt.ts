import * as p from '@clack/prompts'

import type { AgentName } from '@/core/materializer/agent-restrictions'
import type { CodexAgentModelChoice, Provider } from '@/types'

const AGENT_LABELS: { key: AgentName; label: string }[] = [
  { key: 'lead', label: 'Lead' },
  { key: 'explorer', label: 'Explorer' },
  { key: 'consultant', label: 'Consultant' },
  { key: 'builder', label: 'Builder' },
  { key: 'reviewer', label: 'Reviewer' },
]

// Verified against Codex CLI's own Rust source (see task #81 consultant
// advisory for citations): `codex-rs/skills/src/assets/samples/openai-docs/
// references/latest-model.md` lists these 8 slugs. Seven are corroborated by
// repo-wide code-search hits; `gpt-5.3-codex-spark` has none, but the user
// explicitly confirmed keeping it (they trust the live picker over a
// public-repo grep). This is a plain string list, not a TS literal union —
// model catalogs go stale fast, and a hardcoded compile-time union would
// turn a stale entry into a hard error for someone hand-editing a newer
// model into their TOML.
export const CODEX_MODEL_CHOICES = [
  'gpt-6-astra',
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-5.6-luna',
  'gpt-5.5',
  'gpt-5.4',
  'gpt-5.4-mini',
  'gpt-5.3-codex-spark',
] as const

// Intersection of Codex's real `ReasoningEffort` wire enum
// (`codex-rs/protocol/src/openai_models.rs`: none|minimal|low|medium|high|
// xhigh|max|ultra|Custom) and the whitelist its own per-agent-role-file
// writer accepts (`codex-rs/external-agent-migration/src/subagents.rs`,
// `map_agent_reasoning_effort`, which also rewrites max→xhigh and drops
// ultra). `none` is deliberately excluded from this picker — it disables
// reasoning entirely, a footgun for a lead/reviewer role; a user who wants
// it can still hand-edit the TOML.
const CODEX_EFFORT_CHOICES = ['minimal', 'low', 'medium', 'high', 'xhigh'] as const

/**
 * Codex CLI only: prompt once per generated role (lead, explorer, consultant,
 * builder, reviewer) for a model AND a reasoning-effort preference. Both
 * choices are written straight into that role's generated
 * `.codex/agents/<role>.toml` (`model = "..."` / `model_reasoning_effort =
 * "..."` lines) — never into config.toml, which carries its own separate
 * top-level default (see `ensureTomlTopLevelKey` in mcp-merge.ts).
 *
 * Mirrors `promptClaudeAgentModels` (claude-model-prompt.ts) in shape and
 * cancel-handling. Returns `{}` immediately for any other provider, so call
 * sites (currently only `ahk init`) don't need their own provider guard
 * before calling this — and no other provider's init can ever hang on these
 * prompts.
 */
export async function promptCodexAgentModels(
  provider: Provider
): Promise<Partial<Record<AgentName, CodexAgentModelChoice>>> {
  const codexAgentModels: Partial<Record<AgentName, CodexAgentModelChoice>> = {}
  if (provider !== 'codex-cli') return codexAgentModels

  for (const agent of AGENT_LABELS) {
    const modelVal = await p.select({
      message: `Model for ${agent.label}`,
      options: CODEX_MODEL_CHOICES.map((value) => ({ value, label: value })),
      initialValue: 'gpt-5.6-terra',
    })
    if (p.isCancel(modelVal)) {
      p.cancel('Cancelled.')
      process.exit(0)
    }

    const effortVal = await p.select({
      message: `Reasoning effort for ${agent.label}`,
      options: CODEX_EFFORT_CHOICES.map((value) => ({ value, label: value })),
      initialValue: 'medium',
    })
    if (p.isCancel(effortVal)) {
      p.cancel('Cancelled.')
      process.exit(0)
    }

    codexAgentModels[agent.key] = {
      model: modelVal as string,
      effort: effortVal as CodexAgentModelChoice['effort'],
    }
  }

  return codexAgentModels
}
