/**
 * Internal, provider-agnostic model of what each role is *not* allowed to do.
 *
 * This is deliberately a tiny closed vocabulary rather than a literal list of
 * tool names: the three supported providers do not share a permission model,
 * so a single "denylist of tools" cannot be translated verbatim to all of them.
 * Each provider's materializer translates the restriction below into its own
 * native semantics:
 *
 *   restriction   | Claude Code                  | OpenCode                 | Codex CLI                    | Grok Build
 *   --------------|------------------------------|--------------------------|-------------------------------|---------------------------------
 *   'none'        | omit `tools` (inherit all)   | omit `permission`        | sandbox_mode="workspace-write" | omit `tools` (inherit all)
 *   'no-write'    | disallowedTools: Write, Edit | permission: { edit: deny } | sandbox_mode="read-only"      | tools: <allowlist, no Write/Edit>
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
 *  - Grok Build's `tools:` frontmatter field is the INVERSE shape of Claude's:
 *    an ALLOWLIST, not a denylist. There is no way to say "everything except
 *    Write/Edit" — the no-write role must enumerate every tool it IS allowed.
 *    The allowlist below (PascalCase tool-class names, matching the vocabulary
 *    Grok's own permission-rule engine enforces against, plus the two MCP
 *    discovery meta-tools `search_tool`/`use_tool`) was resolved by the task
 *    #76 consultant advisory after the docs turned out to use two competing
 *    naming conventions with no single reconciling reference page. Bash is
 *    included deliberately, consistent with Claude/OpenCode's existing
 *    no-write scope (a tool-visibility restriction, not an OS sandbox like
 *    Codex's) — see `grokToolsAllowlist` below.
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

// ─── Grok Build ──────────────────────────────────────────────────────────────

/**
 * Tool allowlist for Grok Build's `tools:` frontmatter field.
 *
 * Unlike Claude Code's `disallowedTools`/OpenCode's `permission` (both
 * denylist-shaped), Grok Build's `tools:` field is an ALLOWLIST: an agent may
 * only call tools named in this list, so "no-write" must enumerate everything
 * it IS allowed rather than the two things it isn't.
 *
 * Names are PascalCase tool-class names (`Bash`, `Read`, `NotebookRead`,
 * `Grep`, `Glob`, `WebFetch`, `WebSearch`) plus the two MCP discovery
 * meta-tools (`search_tool`, `use_tool`) that have no PascalCase form
 * documented anywhere in Grok Build's docs. This is Convention A per the task
 * #76 consultant advisory: Grok's own permission-rule engine
 * (22-permissions-and-safety.md "Tool Names") only recognizes these names, so
 * they are not just best-evidence but the only reading under which the
 * frontmatter allowlist and the permission-rule engine can refer to the same
 * tool. `Bash` is included even for 'no-write' roles — matching the existing
 * precedent that Claude's `disallowedTools: ['Write','Edit']` and OpenCode's
 * `edit: deny` both already leave Bash fully permitted for a tool-visibility
 * restriction (as opposed to Codex's OS-level sandbox).
 *
 * Returns `[]` for the 'none' role (builder) so the caller's
 * `appendFrontmatterBlockSequence` no-ops and `tools:` is omitted entirely,
 * inheriting every tool — the same "empty array means inherit everything"
 * contract `claudeDisallowedTools` already uses.
 */
export function grokToolsAllowlist(agentName: AgentName): string[] {
  return restrictionFor(agentName) === 'no-write'
    ? ['Bash', 'Read', 'NotebookRead', 'Grep', 'Glob', 'WebFetch', 'WebSearch', 'search_tool', 'use_tool']
    : []
}
