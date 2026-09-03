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
 *   'none'        | omit `tools` (inherit all)   | omit `permission`        | sandbox_mode="danger-full-access" | omit `tools` (inherit all)
 *   'no-write'    | disallowedTools: Write, Edit | permission: { edit: deny } | sandbox_mode="danger-full-access" (enforced by prose only — see below) | tools: <allowlist, no Write/Edit>
 *
 * Notes on the asymmetries this abstraction hides:
 *  - OpenCode has NO separate `write` permission. Its `edit` permission is
 *    documented as "file modifications including write/patch", so a single
 *    `edit: deny` covers Write + Edit + patch. Emitting two keys would be wrong.
 *  - Codex CLI has no per-agent tool denylist at all, and as of task #83 it
 *    also has no OS-level sandbox: by deliberate, user-chosen project
 *    configuration, ALL 5 roles run with `sandbox_mode = "danger-full-access"`
 *    (fully unsandboxed), including the 'no-write' roles. `restrictionFor()`
 *    is intentionally ignored by `codexSandboxMode()` for this reason. The
 *    no-write restriction for those roles under Codex is therefore enforced
 *    ENTIRELY by the prose restated in `developer_instructions`
 *    (`CODEX_READ_ONLY_NOTICE`) — there is no technical enforcement left. See
 *    README.md for the documented tradeoff.
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
export function opencodePermissions(
  agentName: AgentName
): Record<string, 'allow' | 'ask' | 'deny'> {
  return restrictionFor(agentName) === 'no-write' ? { edit: 'deny' } : {}
}

// ─── Codex CLI ───────────────────────────────────────────────────────────────

export type CodexSandboxMode = 'workspace-write' | 'read-only' | 'danger-full-access'

/**
 * All 5 Codex roles run fully unsandboxed by deliberate, user-chosen project
 * configuration (task #83) — `restrictionFor()` is intentionally NOT consulted
 * here. This removes the only OS-level enforcement Codex CLI had for the
 * no-write roles; see `CODEX_READ_ONLY_NOTICE` below for the prose-only
 * backstop that replaces it, and README.md for the documented tradeoff.
 */
export function codexSandboxMode(_agentName: AgentName): CodexSandboxMode {
  return 'danger-full-access'
}

/**
 * Prose restated inside `developer_instructions`. Since sandbox_mode is now
 * `danger-full-access` for every role (task #83, user-chosen), this notice is
 * no longer a redundant backstop to an OS sandbox — it is the ONLY thing
 * enforcing the no-write restriction for lead/explorer/consultant/reviewer
 * under Codex CLI. A violation will not be technically rejected by anything;
 * it will silently corrupt the harness's audit trail and workflow guarantees.
 */
export const CODEX_READ_ONLY_NOTICE = `## Tool restrictions (enforced by instruction only — NOT by the sandbox)

This agent runs UNSANDBOXED: \`sandbox_mode = "danger-full-access"\`. There is no OS-level write protection. This is a deliberate project configuration choice, not an oversight.

You MUST NOT create, modify, or delete any file: no \`Write\`, no \`Edit\`, no \`apply_patch\`, and no shell command that writes to disk (\`>\`, \`tee\`, \`sed -i\`, \`mv\`, \`rm\`, ...). This restriction is enforced ONLY by you following this instruction — nothing will technically block or reject the call.

If you find yourself about to perform a write, STOP. Do not perform it. Report it as a blocker instead. Treat this as a hard rule: breaking it will not fail loudly, it will silently break the harness's audit trail and workflow guarantees.`

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
    ? [
        'Bash',
        'Read',
        'NotebookRead',
        'Grep',
        'Glob',
        'WebFetch',
        'WebSearch',
        'search_tool',
        'use_tool',
      ]
    : []
}
