# Implementation plan: safe sync and persisted agent model preferences

## 1. Represent preferences in configuration

Files: `src/types.ts`, `src/core/config.ts`, `src/commands/init-helpers.ts`,
`src/core/materializer/templates.ts`, focused config/template tests.

- Add provider-aware, per-role preference types to `HarnessConfig`. Preserve a
  model for all supported selectors and effort only where the selector exposes
  it.
- Extend generated TS, MJS, CJS, and JSON config templates and init defaults so
  newly created projects have a stable, initially empty preference container.
- Add config-path and safe JSON read/write helpers. JSON mutation must parse,
  merge only `agentPreferences`, write atomically, and reload/verify the saved
  configuration.
- Add a renderer for code-backed config guidance. It must emit a precise
  copy-ready preference block but never rewrite TS, JS, MJS, or CJS source.

## 2. Centralize selection, persistence, and migration logic

Files: new focused preference service under `src/commands/` or `src/core/`,
`claude-model-prompt.ts`, `codex-model-prompt.ts`, `cursor-model-prompt.ts`,
focused unit tests.

- Normalize each existing provider selector result into the shared preference
  shape and convert stored values back into the materializer choice shape.
- Provide a resolver for forced generation: prompt every role normally, or,
  with `keepModels`, use stored values and prompt only gaps.
- Persist interactive selections only after all prompts successfully resolve;
  report a persistence failure before files are regenerated.
- Read existing provider-native agent metadata for capture mode. Report
  unparseable/missing model or effort values as gaps rather than guessing.

## 3. Wire init and build to the common service

Files: `src/commands/init.ts`, `src/commands/build.ts`, related command tests.

- In `init`, collect normal choices, write them to the newly generated config,
  and then pass them to the materializer exactly as today.
- In `build --force`, collect choices via the common resolver and update the
  existing project config before materialization.
- Retain `build` without `--force` as a non-interactive, ownership-preserving
  command. Keep `build --sync` backward compatible during this release.

## 4. Add the `sync` command and capture migration mode

Files: new `src/commands/sync.ts`, `src/cli.ts`, CLI/command tests.

- Register `ahk sync`, `--force`, `--keep-models`, and `--capture-models`.
- Implement default sync by calling the same safe build/materialization path:
  refresh skills and derived generated files, create missing agents, preserve
  user-owned agent files, and never prompt.
- Implement `--force` through the shared forced-generation resolver.
- Reject `--keep-models` unless `--force` is set, and reject combinations with
  `--capture-models` that would ambiguously combine migration and regeneration.
- Implement capture as a read-only agent-file scan plus configuration update:
  JSON receives an atomic merge and verification; code config prints the exact
  block to add and exits successfully only after it is already present.

## 5. Cover compatibility and user-visible output

Files: command tests, materializer tests, `README.md`.

- Test model-only and model-plus-effort providers, a partial stored preference
  set, JSON write/verification, code-config no-write output, and capture from
  each native agent format.
- Test that safe sync preserves edits, forced sync retains backups, and
  keep-models eliminates prompts when preference coverage is complete.
- Update README command help, existing-project migration instructions, config
  examples, and remove the stale JSON/SQLite backlog-sync description.

## 6. Verify and close

- Run focused command/config/materializer/README tests, then `bash health.sh`.
- Re-run server-owned `health.run(52)`, mark the acceptance criteria met, and
  close the task only through `tasks.update(52, 'done')` after fresh health
  passes.
