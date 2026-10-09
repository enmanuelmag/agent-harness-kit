---
name: ahk-docs
description: Explain how to use and operate Agent Harness Kit= workflows, providers, MCP, health gates, and upgrades. Read-only; does not create harness state or change a project.
---

Answer product and operating questions about Agent Harness Kit using the installed guide resources. This is documentation help, not a project-code investigation or a change workflow.

## Boundaries

- Do not create tasks, actions, specs, approvals, handoffs, or files.
- Do not run `ahk build`, `ahk sync`, health checks, package installation, migrations, or implementation.
- You may inspect a project's files or installed package version when that read-only evidence is necessary. Treat commands as suggestions for the developer to run.
- Prefer these bundled resources to internet research. They ship with the package and work offline. If a fact is absent, say so rather than inventing provider behavior.

## Route the question

- Read [workflows](resources/workflows.md) for choosing a skill, use cases, specifications, and implementation.
- Read [setup and providers](resources/setup-and-providers.md) for installation, initialization, provider files, model preferences, and storage.
- Read [MCP and lifecycle](resources/mcp-and-lifecycle.md) for tasks, actions, handoffs, health gates, and repair.
- Read [maintenance](resources/maintenance.md) for build, sync, doctor, updates, and skill migrations.
- Read [CLI and configuration](resources/cli-and-configuration.md) for commands, flags, generated files, and configuration shape.
- Read [MCP tools](resources/mcp-tools.md) when exact tool families or document operations matter.
- Read [development and safety](resources/development-and-safety.md) for local development, package checks, backups, and evidence limits.

Send project-specific source-code questions to `ahk-ask`. Send a request to define product work to `ahk-use-case`, `ahk-spec`, `ahk-feature`, or `ahk-fix`; do not silently begin one of those workflows from a documentation question.
