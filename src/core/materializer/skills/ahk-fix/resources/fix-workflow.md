# Fix workflow

1. Capture the issue/Jira request, symptom, impact, affected scope, expected behavior, and actual behavior.
2. Inspect relevant specifications, documentation, code, contracts, tests, logs, and reproduction evidence.
3. Ask one necessary question at a time for reproduction, boundaries, dependencies, risks, validation, and acceptance evidence.
4. Record a cause as confirmed only when evidence supports it; otherwise record it as a hypothesis.
5. Once the synthesis is complete, persist it as a `fix` draft and validate it.
6. Require explicit approval before it can source a technical specification.

The MCP assigns new documents a `YYYY-MM-DD-<slug>.md` filename using the UTC creation date. Use the returned `filePath` (relative to the configured docs directory) to locate the artifact; do not reconstruct or rename it. The prefix belongs only to the physical filename: keep the logical slug, title, source references, and relationships unchanged. Existing files retain their paths on every update.
