# Documentation research policy plan

## Objective

Make lead and consultant ground library, framework, SDK, API, CLI, cloud-service, and provider recommendations in current documentation and the project's installed dependency versions.

The policy must prevent suggestions that mix APIs from different versions. Every dependency-related consultation or implementation plan must state whether the project needs an upgrade, a new dependency, or no dependency change.

## Terminology

- **Context7**: version-aware documentation retrieval for libraries and frameworks. Resolve a library ID first, then query one concept at a time.
- **Mintlify Index**: technical search across publisher-maintained Mintlify documentation with web fallback. This is the correct product name.
- **Web search**: broader current research for release notes, provider behavior, standards, cloud services, and information outside indexed documentation.
- **Graphify**: local codebase and project-structure understanding. It does not replace current dependency documentation.
- **Autoskills**: discovery of missing reusable agent skills. It does not prove library APIs or version compatibility.

Context7, Mintlify Index, and web search provide external evidence. Package manifests, lockfiles, generated clients, source imports, and configuration provide local version and usage evidence. Plans need both when the request depends on installed software.

## Trigger policy

### Lead

Lead must initiate current-documentation research when any of these conditions applies:

- the user asks to research, search, verify, compare, or find current information;
- the task concerns a library, framework, SDK, API, CLI, cloud service, LLM provider, or model capability;
- a proposed plan depends on behavior that may differ by version;
- the task spans a whole codebase and requires external technical context;
- the plan may require installing, removing, or upgrading dependencies.

Lead should delegate bounded research when the work can run independently. The delegated prompt must specify sources, installed versions, scope, expected citations, and the dependency-impact conclusion.

Lead must not invoke external research for isolated business-logic debugging, mechanical refactors, or questions answered completely by current project code and tests.

### Consultant

Consultant must prioritize Context7 when its advice depends on an installed library, framework, SDK, API client, CLI, or cloud-service contract.

Before proposing a plan, consultant must:

1. inspect the project's relevant manifests and lockfiles;
2. identify the installed or resolved version;
3. inspect existing imports, generated contracts, and configuration when relevant;
4. resolve the official Context7 library ID;
5. query documentation for one concept at a time;
6. compare documented behavior with the installed version and current code;
7. use Mintlify Index or official web sources when Context7 lacks sufficient coverage;
8. state the dependency impact explicitly.

Consultant must not present an API, option, flag, or configuration field as available unless the evidence applies to the project's installed version or the plan includes the required upgrade.

## Source order

Use this order for dependency-bound technical questions:

1. Current project evidence: manifest, lockfile, generated contracts, imports, configuration, and tests.
2. Context7 with the exact library and relevant version when available.
3. Mintlify Index for publisher-maintained technical documentation and cross-product retrieval.
4. Official documentation, repositories, specifications, and release notes through web search.
5. Secondary sources only when primary sources do not answer the question. Label them as secondary.

For non-library current research, start with official web sources. Context7 should not be forced onto topics it does not cover.

## Required dependency-impact conclusion

Every affected consultant report, plan, or implementation handoff must include:

```text
Dependency impact
- Installed version(s): ...
- Required capability: ...
- Compatibility: supported | unsupported | uncertain
- Upgrade required: yes | no
- New dependency required: yes | no
- Proposed version or package: ... | none
- Evidence: local files plus documentation sources
```

If evidence is unavailable, use `uncertain`. Do not convert uncertainty into an upgrade recommendation.

When an upgrade is required, the report must include:

- minimum compatible version;
- relevant breaking changes;
- affected project consumers;
- migration work;
- verification needed;
- whether the upgrade belongs in the current task or a separate task.

When no upgrade is required, say so directly and cite the installed-version evidence.

## Agent responsibilities

### Lead

- Detect research triggers.
- Decide which questions can be researched in parallel.
- Require official or version-aware sources.
- Pass research evidence into consultant and builder handoffs.
- Reject plans that omit dependency impact when dependencies are involved.
- Keep research bounded to the task.

### Explorer

- Identify manifests, lockfiles, generated clients, imports, configuration, and existing patterns.
- Report exact local versions and relevant file references.
- Separate local proof from external documentation.
- Do not choose upgrades unless the delegated task requests compatibility analysis.

### Consultant

- Use Context7 as the primary documentation source for dependency-bound advice.
- Use Mintlify Index or web search to close coverage gaps and verify current provider behavior.
- Align recommendations with installed versions.
- Identify upgrade and new-dependency requirements.
- Distinguish confirmed behavior, inference, and uncertainty.
- Provide the builder with source-backed constraints rather than generic best practices.

### Builder

- Implement only the dependency decision approved in the plan or handoff.
- Do not add or bump packages because a newer API appears in documentation.
- Record manifest and lockfile changes explicitly.
- Run version-appropriate verification.

### Reviewer

- Check that dependency-related claims have local and external evidence.
- Block code that uses APIs unavailable in the installed version.
- Verify declared upgrades, lockfile changes, migrations, and documentation.
- Require the dependency-impact conclusion when the task touches external packages.

## Tool availability and fallback

Instructions must describe capabilities, then use the available provider-native tool names.

- If Context7 is available, resolve the library ID before querying docs.
- If the user supplies an exact Context7 ID, query it directly.
- If Context7 cannot resolve the library or lacks the needed version, record that limitation and continue with Mintlify Index or official web sources.
- If Mintlify Index is unavailable, use official web documentation.
- If web access is unavailable, report the proof boundary and do not describe remembered behavior as current.
- Never invent a tool call, source result, installed version, or compatibility conclusion.

The generated instructions should not assume every provider exposes identical MCP names. Provider materializers may inject the available tool aliases, but the research contract stays common.

## Context and cost control

External research must remain scoped:

- resolve one library once per task;
- query one concept per documentation request;
- avoid loading full documentation sites when focused pages answer the question;
- send summaries and source links through handoffs instead of raw outputs;
- parallelize independent documentation questions, not dependent planning stages;
- reuse verified version evidence within the same task;
- prefer local generated contracts over broad upstream examples when the project already has authoritative declarations.

## Implementation phases

### Phase 1: Add the shared research contract

1. Add trigger and source-order guidance to the canonical project index.
2. Add lead instructions for detecting research needs and delegating bounded searches.
3. Strengthen consultant instructions around Context7, installed versions, compatibility, and dependency impact.
4. Add reviewer checks for version/API mismatches.
5. Keep Graphify and Autoskills guidance, but state that they do not replace current documentation.

### Phase 2: Add provider-aware capability hints

1. Introduce a small provider research-capability adapter or reuse the provider guidance registry if the delegation plan lands first.
2. Map semantic capabilities to available provider-native tools without duplicating the research policy.
3. Cover Context7, Mintlify Index, and web search availability explicitly.
4. Define graceful fallback text for missing tools.

### Phase 3: Update handoffs and outputs

1. Add the dependency-impact block to consultant guidance.
2. Require local-version evidence in explorer results when dependencies matter.
3. Carry compatibility and upgrade decisions into builder handoffs.
4. Require reviewer verification of dependency changes.

### Phase 4: Documentation and examples

1. Document when research is mandatory and when it is unnecessary.
2. Add examples for a supported installed API, a required version bump, a new package, and insufficient evidence.
3. Document Context7 resolution/query behavior and the Mintlify Index fallback.
4. Explain how provider-specific tool availability affects execution without changing the common policy.

## Tests

Add tests that prove:

- lead instructions contain the research triggers and bounded-delegation rules;
- consultant instructions prioritize Context7 for dependency-bound advice;
- consultant output requires installed version, compatibility, upgrade, and new-dependency decisions;
- local evidence precedes external recommendations;
- Mintlify Index and official web search appear as fallbacks, not universal requirements;
- Graphify and Autoskills are not described as documentation evidence;
- provider-native tool names do not leak into the shared research policy;
- every provider receives a valid capability hint or fallback;
- reviewer blocks version-incompatible API usage;
- unchanged dependency tasks can conclude `Upgrade required: no` and `New dependency required: no`;
- missing documentation yields `uncertain` rather than an invented answer;
- generated skills and index files remain consistent across generation paths.

## Acceptance criteria

- Lead initiates external research for explicit research requests and version-sensitive technical work.
- Consultant prioritizes Context7 whenever advice depends on installed dependencies.
- Mintlify Index is named and used correctly as a technical documentation and web retrieval source.
- Web search covers current information outside documentation indexes.
- Plans compare documentation with real installed versions.
- Every dependency-related plan states whether an upgrade or new dependency is required.
- Recommendations never mix APIs from incompatible versions without declaring the required migration.
- Missing tools or evidence produce an explicit limitation instead of a hallucinated answer.
- Provider-specific tool aliases remain outside the shared semantic policy.
- Tests and docs cover triggers, fallbacks, compatibility decisions, and proof boundaries.
- The full health check exits successfully.

## Out of scope

- Automatically upgrading dependencies.
- Installing Context7, Mintlify Index, or web-search services for the user.
- Replacing generated API contracts with documentation examples.
- Requiring internet research for project-local business logic.
- Treating secondary blog posts as authoritative library contracts.

## Kickoff prompt

```text
Implement the plan in docs/documentation-research-policy-plan.md.

Start by reading AGENTS.md and the plan. Run bash health.sh before making changes and stop if it fails. Use the Harness lead -> explorer -> consultant -> builder -> reviewer workflow. Keep this task scoped to research policy, version-aware dependency guidance, provider capability hints, tests, and documentation; do not implement the separate provider-delegation refactor unless this task needs a narrow shared seam.

Make lead initiate bounded current-documentation research when the user asks for research or when a plan depends on version-sensitive libraries, frameworks, SDKs, APIs, CLIs, cloud services, or LLM providers. Make consultant inspect manifests and lockfiles, identify installed versions, prioritize Context7, fall back to Mintlify Index or official web sources, and compare every recommendation with current project code and versions.

Require a dependency-impact conclusion with installed version, compatibility, upgrade required, new dependency required, proposed package/version, and evidence. Do not suggest APIs from newer releases unless the plan declares the upgrade and migration. Preserve Graphify and Autoskills as codebase/skill discovery aids, but state that neither proves current dependency behavior.

Keep the semantic policy provider-neutral. Isolate provider-native tool aliases and missing-tool fallbacks in a small adapter. Add tests for triggers, source order, version alignment, no-upgrade conclusions, required upgrades, uncertainty handling, reviewer blocking, all providers, and generation parity.

Do not commit. Finish by running focused tests, bash health.sh, and git diff --check. Report changed files, documentation sources consulted, dependency impact for this implementation, verification with exit codes, and remaining proof boundaries.
```
