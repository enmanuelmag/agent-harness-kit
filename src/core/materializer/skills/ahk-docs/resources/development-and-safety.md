# Development, backups, and safety

For changes to this package, run the checks appropriate to the changed surface:

```bash
pnpm test
pnpm typecheck
pnpm lint:check
pnpm build
```

The dashboard is a separate Vite workspace. For interactive dashboard work, run:

```bash
pnpm --filter ahk-dashboard run dev
pnpm --filter ahk-dashboard run typecheck
pnpm --filter ahk-dashboard run build
```

`pnpm build` also copies canonical skill resources into `dist/skills`, which is what the published package materializes. A package dry run can confirm that the bundled assets are present before publishing.

To test a release candidate in another project, install that candidate globally. In the target project, run `ahk --version`, then use that same CLI to initialize or regenerate the project. A successful package build does not prove every provider has reloaded or accepted generated files.

Before `reset`, `build --force`, storage migration, or an applied document migration, inspect the target and retain a backup. AHK creates backups for the destructive generated-agent and non-empty-storage paths it owns, but project files and external databases still need the team's normal backup process.

Do not put secrets in specification text, handoffs, screenshots, or exports. Review provider configuration and exported database content before sharing it. For a security report, follow the repository's `SECURITY.md` rather than opening a public issue.

Static checks prove syntax, types, and exercised behavior. They do not prove deployment, browser visuals, real-device behavior, provider account permissions, external integrations, or production data safety unless those environments were explicitly tested.


## Command failures

The CLI awaits asynchronous commands and reports execution failures once on stderr with command context, then exits nonzero. Help/version, cancellation and health commands preserve their normal exit semantics. A fatal `ahk build --watch` rebuild or watcher failure closes the watcher and exits with status 1; automatic rebuilds never force regeneration of existing files.

Update notices are advisory. A reporting failure does not turn a completed command into a failed operation. CLI update banners are suppressed for stdio serving and JSON commands to keep their output machine-readable; MCP operational notices remain available. MCP tools preserve their existing `isError` and text responses and validate successful structured output.
