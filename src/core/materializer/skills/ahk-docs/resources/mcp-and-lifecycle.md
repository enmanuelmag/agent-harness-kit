# MCP and tracked lifecycle

MCP is the source of truth for tracked tasks, actions, handoffs, health records, and acceptance evidence. Markdown specifications are filesystem artifacts; they are related to task work but are not rows in the task database.

The normal tracked sequence is lead, explorer, consultant, builder, then reviewer. The reviewer can return bounded feedback to the builder through a handoff; the lead remains responsible for coordination and final closure.

`tasks.claim` runs server-owned native health before normal implementation. A passing result enters normal mode. A failed result enters blocked mode: diagnosis remains available, but implementation is denied until `tasks.repair.begin(taskId, actor, reason, scope)` records a bounded repair authorization. `tasks.update(taskId, 'done')` runs fresh final health and closes only when it passes.

Health proof must come from a real project command. A placeholder or dummy success cannot establish completion.

Useful MCP families include:

- `tasks.*` for creation, claim, status, acceptance, and closure;
- `actions.*` for started work, recorded results, compact reads, and recipient-directed handoffs;
- `docs.*` and `specs.*` for document search and specification lifecycle;
- `health.run` for a diagnostic rerun.

Exact tool availability can vary by package version and provider configuration. Inspect the installed tool list when an exact name matters.
