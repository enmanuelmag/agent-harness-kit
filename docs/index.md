# Agent Harness Kit documentation

This index points to the maintained entry points; it does not duplicate the product manual.

## Start here

1. Read the [repository README](../README.md) for common workflows, diagrams, and the quick start.
2. Use the bundled [`ahk-docs`](../src/core/materializer/skills/ahk-docs/SKILL.md) skill for offline product help.
3. Choose the focused resource you need:
   - [Workflow and specification routing](../src/core/materializer/skills/ahk-docs/resources/workflows.md)
   - [Installation, providers, and storage](../src/core/materializer/skills/ahk-docs/resources/setup-and-providers.md)
   - [MCP, task lifecycle, health, and repair](../src/core/materializer/skills/ahk-docs/resources/mcp-and-lifecycle.md)
   - [Build, sync, doctor, and migrations](../src/core/materializer/skills/ahk-docs/resources/maintenance.md)
   - [CLI commands and configuration](../src/core/materializer/skills/ahk-docs/resources/cli-and-configuration.md)
   - [MCP tool families](../src/core/materializer/skills/ahk-docs/resources/mcp-tools.md)
   - [Development, packaging, and safety](../src/core/materializer/skills/ahk-docs/resources/development-and-safety.md)

## Historical design references

The following files are archival design material. They can describe retired contracts, including JSON task synchronization or old MCP terminology. Do not use them as operating instructions; use the current bundled guides above.

- [Architecture archive](architecture.md)
- [Components archive](components.md)
- [Implementation archive](implementation.md)
- [Documentation research policy](documentation-research-policy-plan.md)
- [Provider delegation plan](provider-delegation-guidance-plan.md)

For actual project-source questions, use `ahk-ask`. For a change, begin the matching product workflow instead of treating documentation help as authorization to mutate the project.

## Documentation Research Policy

The complete policy is maintained in the [documentation research policy](documentation-research-policy-plan.md) and generated agent instructions in [AGENTS.md](../AGENTS.md). This summary preserves the operational contract without becoming a second manual.

### Trigger Policy

Initiate external documentation research when a request asks to **research, search, verify, compare** a library, framework, SDK, API, CLI, or cloud service; when a proposal depends on version-specific behavior; or when dependencies may change. Ordinary business-logic diagnosis and mechanical refactors do not need external documentation by default.

### Source Order

Start with **Current project evidence**: manifest, lockfile, imports, generated contracts, configuration, and tests. Then use Context7 for the exact library and concept, Mintlify Index when applicable, and official web documentation when the indexed sources are insufficient.

### Dependency-Impact Conclusion

Any dependency-bound recommendation records:

```text
Installed version(s): ...
Compatibility: supported | unsupported | uncertain
Upgrade required: yes | no
New dependency required: yes | no
Proposed version or package: ... | none
Evidence: local files plus documentation sources
```
