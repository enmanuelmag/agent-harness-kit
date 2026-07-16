# Security Policy

## Supported Versions

`@cardor/agent-harness-kit` is a single-maintainer, open-source CLI tool with no LTS branches or parallel maintenance tracks. Only the **latest version published on npm** (currently `1.10.3`) receives security fixes.

| Version                   | Supported |
| ------------------------- | --------- |
| Latest (currently 1.10.3) | ✅        |
| Older releases            | ❌        |

If you're on an older version, please upgrade to the latest release before reporting an issue — it may already be fixed.

## Reporting a Vulnerability

If you discover a security vulnerability in this project (the `agent-harness-kit` CLI or its bundled MCP server), please report it privately by email to:

**enmanuelmag@gmail.com**

Please do not open a public GitHub issue for security vulnerabilities.

When reporting, include as much detail as possible: affected version, a description of the issue, steps to reproduce, and potential impact. This is a best-effort, single-maintainer project — expect an initial response **within 5 business days**.

## Coordinated Disclosure

Please give the maintainer a reasonable opportunity to investigate and release a fix before any public disclosure. Concretely:

- Do not publicly disclose the vulnerability, request a CVE, or publish a security advisory before a fix has been released.
- Allow reasonable time after a fix is released for users to update before going public.
- If you are a security researcher, auditor, or CNA doing outreach (including automated or third-party scanning campaigns), please use the email channel above rather than direct, unsolicited contact through other means. Keeping all reports in one auditable channel helps ensure nothing is missed or mishandled.

## Scope

This policy covers the `agent-harness-kit` CLI and its bundled MCP server. This is not a paid bug bounty program — there is no monetary reward for reports — but credit will gladly be given in release notes if the reporter wishes.
