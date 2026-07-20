/**
 * Internal, provider-agnostic model of what each role is *not* allowed to do.
 *
 * This is deliberately a tiny closed vocabulary rather than a literal list of
 * tool names: the three supported providers do not share a permission model,
 * so a single "denylist of tools" cannot be translated verbatim to all of them.
 * Each provider's materializer translates the restriction below into its own
 * native semantics:
 *
 *   restriction   | Claude Code                  | OpenCode                 | Codex CLI
 *   --------------|------------------------------|--------------------------|-----------------------------
 *   'none'        | omit `tools` (inherit all)   | omit `permission`        | sandbox_mode="workspace-write"
 *   'no-write'    | disallowedTools: Write, Edit | permission: { edit: deny } | sandbox_mode="read-only"
 *
 * Notes on the asymmetries this abstraction hides:
 *  - OpenCode has NO separate `write` permission. Its `edit` permission is
 *    documented as "file modifications including write/patch", so a single
 *    `edit: deny` covers Write + Edit + patch. Emitting two keys would be wrong.
 *  - Codex CLI has no per-agent tool denylist at all. `sandbox_mode` is the only
 *    real mechanism, and it is coarse (it also blocks writes performed via
 *    shell). Because the tools stay *visible* to the model under Codex, the
 *    restriction is additionally restated in `developer_instructions` so the
 *    model does not burn turns on calls the sandbox will reject.
 */

export type AgentName = 'lead' | 'explorer' | 'consultant' | 'builder' | 'reviewer'

export type AgentRestriction = 'none' | 'no-write'

export const AGENT_RESTRICTIONS: Record<AgentName, AgentRestriction> = {
  lead: 'no-write',
  explorer: 'no-write',
  consultant: 'no-write',
  builder: 'none',
  reviewer: 'no-write',
}

export function restrictionFor(agentName: AgentName): AgentRestriction {
  return AGENT_RESTRICTIONS[agentName] ?? 'no-write'
}

// ─── Claude Code ─────────────────────────────────────────────────────────────

/**
 * Tool names Claude Code should refuse for this role. An empty array means the
 * agent inherits everything (including `Task` and all `mcp__*` tools) — which is
 * exactly why `tools` is omitted entirely rather than enumerated.
 */
export function claudeDisallowedTools(agentName: AgentName): string[] {
  return restrictionFor(agentName) === 'no-write' ? ['Write', 'Edit'] : []
}

// ─── OpenCode ────────────────────────────────────────────────────────────────

/**
 * OpenCode `permission` entries for this role. The legacy `tools: { x: false }`
 * dict is deprecated upstream in favour of `permission`, so nothing is emitted
 * for the unrestricted case.
 */
export function opencodePermissions(agentName: AgentName): Record<string, 'allow' | 'ask' | 'deny'> {
  return restrictionFor(agentName) === 'no-write' ? { edit: 'deny' } : {}
}

// ─── Codex CLI ───────────────────────────────────────────────────────────────

export type CodexSandboxMode = 'workspace-write' | 'read-only'

export function codexSandboxMode(agentName: AgentName): CodexSandboxMode {
  return restrictionFor(agentName) === 'no-write' ? 'read-only' : 'workspace-write'
}

/**
 * Prose restated inside `developer_instructions`. Codex keeps write tools
 * visible to the model even under a read-only sandbox, so config alone is not
 * enough — without this the model repeatedly attempts writes and fails.
 */
export const CODEX_READ_ONLY_NOTICE = `## Tool restrictions (enforced by the sandbox)

This agent runs with \`sandbox_mode = "read-only"\`. You MUST NOT create, modify, or delete any file: no \`Write\`, no \`Edit\`, no \`apply_patch\`, and no shell command that writes to disk (\`>\`, \`tee\`, \`sed -i\`, \`mv\`, \`rm\`, ...).

These tools may still appear available to you. The sandbox will reject the call. Do not retry a rejected write — report it as a blocker instead.`

export function codexRestrictionNotice(agentName: AgentName): string {
  return restrictionFor(agentName) === 'no-write' ? CODEX_READ_ONLY_NOTICE : ''
}
