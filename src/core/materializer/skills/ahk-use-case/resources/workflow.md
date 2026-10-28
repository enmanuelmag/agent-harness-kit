# Use-case workflow

Ask one question at a time. Establish actor, goal, trigger, preconditions, main path, alternatives, failures, rules, and observable result. Split independent actor-goal-result scenarios before saving a draft.

The MCP assigns new documents a `YYYY-MM-DD-<slug>.md` filename using the UTC creation date. Use the returned `filePath` (relative to the configured docs directory) to locate the artifact; do not reconstruct or rename it. The prefix belongs only to the physical filename: keep the logical slug, title, source references, and relationships unchanged. Existing files retain their paths on every update.
