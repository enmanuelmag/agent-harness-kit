# Feature workflow

1. Capture the initial idea or Jira request, actors, problem, and desired outcome.
2. Inspect relevant specifications, documentation, code, contracts, tests, and prior decisions; distinguish evidence from assumptions.
3. Ask one necessary question at a time for missing flow, rules, scope, exclusions, dependencies, risks, and acceptance evidence.
4. Once the synthesis is complete, persist it as a `feature` draft and validate it.
5. Keep decisions and open questions explicit while the draft is reviewed or edited through MCP.
6. Require explicit approval before it can source a technical specification.

The MCP assigns new documents a `YYYY-MM-DD-<slug>.md` filename using the UTC creation date. Use the returned `filePath` (relative to the configured docs directory) to locate the artifact; do not reconstruct or rename it. The prefix belongs only to the physical filename: keep the logical slug, title, source references, and relationships unchanged. Existing files retain their paths on every update.
