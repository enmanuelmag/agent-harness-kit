# Safe sync and persisted agent model preferences

## Goal

Provide a non-destructive `ahk sync` command for project materialization, and
preserve each selected provider/role model preference in
`agent-harness-kit.config.ts`. Providers that support a reasoning-effort
selection preserve it together with the model.

## Command contract

| Command | Agent files | Selectors | Preferences |
| --- | --- | --- | --- |
| `ahk sync` | Create missing files; preserve existing user-owned files | Never | Read-only |
| `ahk sync --force` | Regenerate files after the existing backup policy | Prompt for every selected provider/role | Replace stored choices with new choices |
| `ahk sync --force --keep-models` | Regenerate files after the existing backup policy | Prompt only where no stored choice exists | Reuse stored choices and save prompted gaps |
| `ahk sync --capture-models` | No materialization | Never | Imports detected existing agent choices |

`sync` uses the same safe materialization rules already used by build: skills
are refreshed from their canonical copies; derived instruction files reconcile
only when they remain generated; existing agent files are not overwritten
without `--force`.

`--keep-models` is valid only with `--force`; invoking it alone is a CLI usage
error. This avoids a flag with no observable effect on a non-destructive sync.

`--capture-models` is the setup migration for an existing project that has
agent files but no `agentPreferences`. It reports its detected values by
provider and role, without regenerating agents or skills.

## Configuration model

The project configuration is the source of truth for selections:

```ts
agentPreferences: {
  claudeCode?: {
    lead?: { model: '...' },
  },
  codexCli?: {
    builder?: { model: '...', reasoningEffort: 'medium' },
  },
  cursor?: {
    reviewer?: { model: '...', reasoningEffort: 'high' },
  },
}
```

The actual provider keys and choice shapes will use the repository's existing
provider and prompt types. A preference always contains a model. It contains
an effort only for a provider/selector that exposes one; no synthetic effort
default is written for a model-only provider.

## Selection and persistence flow

1. `init` prompts for its normal model choices, then writes every result to
   `agentPreferences` before generating provider files.
2. `build --force` keeps its current interactive behavior, then persists its
   newly selected choices to the same configuration field.
3. `sync --force --keep-models` resolves each provider/role from
   `agentPreferences`. Missing values invoke the existing selector only for
   that provider/role, then are immediately persisted.
4. Materializers receive the resolved choices exactly as they do today; they
   do not parse generated agent files to discover configuration.

If the project config cannot be safely rewritten (for example an unsupported
config format), the command reports a clear error before materialization rather
than claiming that selections were persisted.

## Existing-project migration

`ahk sync --capture-models` reads the provider-native generated agent metadata
to assemble a candidate preference set. It never infers values that are absent
from those files; missing model or effort values are reported as missing.

- For a JSON configuration, the command safely writes the detected
  `agentPreferences` block into the configuration and then verifies the saved
  values.
- For JavaScript, MJS, and TypeScript configurations, the command must not
  rewrite arbitrary user code. It prints a copy-ready, provider/role-specific
  `agentPreferences` block and the exact property location where it belongs.
  A subsequent `ahk sync --capture-models` verifies that the user saved it.

This migration path makes `sync --force --keep-models` available to an existing
setup without requiring a destructive regeneration or a second interactive
selection pass.

## Implementation boundaries

- Register a top-level `sync` command and options in the CLI.
- Reuse build/materializer logic rather than duplicating file ownership,
  skill-copy, or derived-file reconciliation behavior.
- Add typed configuration schema, load, and write support for preferences.
- Keep `build --sync` compatible until documentation and callers can migrate;
  it must not be represented as the primary synchronization interface.
- Update the README command reference and examples to match the implemented
  behavior; remove stale task-backlog synchronization claims.

## Verification

Tests must prove that:

1. `sync` performs safe, non-interactive synchronization.
2. `sync --force` prompts and persists model choices, including available
   efforts.
3. `sync --force --keep-models` consumes saved choices without prompting.
4. A partial preference set prompts only for missing roles and persists them.
5. Providers without effort preserve only their model.
6. `capture-models` imports JSON configuration safely and prints a correct
   copy-ready block for JS, MJS, and TS configuration without modifying them.
7. Existing preservation/backup behavior remains intact.
8. README examples and CLI help accurately describe all four modes.
