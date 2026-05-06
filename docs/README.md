# Agent Harness Kit Documentation

## Overview

The agent-harness-kit is a provider-agnostic scaffolding solution for running structured, coordinated multi-agent workflows in codebases. It provides a framework where AI agents can work together systematically on development tasks through defined roles with specific responsibilities.

## Key Features

- **Provider Agnostic**: Works with Claude Code, OpenCode, or any MCP-compatible AI tool
- **Structured Workflow**: Implements a 4-agent workflow (Lead, Explorer, Builder, Reviewer) 
- **Task Management**: Provides a task backlog with acceptance criteria
- **Audit Trail**: Full logging of every action, file modification, and tool usage
- **Health Checks**: Ensures code quality through configurable health checks
- **No External Dependencies**: Uses SQLite for local state management without external services

## Architecture Components

### The Four Agent Roles

1. **Lead Agent**
   - Orchestrates the workflow for one task at a time
   - Decomposes tasks into plans for other agents
   - Coordinates handoffs between Explorer → Builder → Reviewer
   - Manages session state and task completion

2. **Explorer Agent** 
   - Reads and maps codebase files for a specific task
   - Identifies relevant patterns, constraints, and existing implementations
   - Never modifies files - only analyzes them
   - Produces structured analysis for the builder

3. **Builder Agent**
   - Implements exactly what was planned in the lead's plan
   - Works within defined writable paths
   - Follows established codebase conventions 
   - Makes targeted implementation changes with test verification

4. **Reviewer Agent**
   - Verifies that all acceptance criteria are met
   - Runs health checks before approving work
   - Approves or blocks tasks based on strict criteria
   - Provides actionable feedback for corrections

### Core Concepts

- **Tasks**: Structured units of work defined in `feature_list.json`
- **Actions**: Individual steps within a task (actions.start/complete)
- **Sections**: Components that can be logged during an action (result, files_modified, etc.)
- **Health Checks**: Predefined scripts run before task initiation and completion
- **MCP Protocol**: Model Communication Protocol for interacting with AI agents

### How It Works

1. Initialize the harness in a project using `ahk init`
2. Create or identify tasks in the backlog (`feature_list.json`)
3. Agents claim tasks and execute their roles in sequence
4. All activities are logged in a local SQLite database (`harness.db`)
5. The dashboard provides real-time visualization of all activities

## Getting Started

1. Install the package as a development dependency:
   ```bash
   npm install --save-dev @cardor/agent-harness-kit
   ```

2. Initialize in your project:
   ```bash
   npx ahk init
   ```

3. Configure your workflow by customizing:
   - `agent-harness-kit.config.ts` for project settings
   - Agent definitions in `.claude/agents/*.md`
   - Health check script (`health.sh`)
   - Task backlog in `.harness/feature_list.json`

## Command Reference

### Core Commands
- `ahk init` - Initialize the harness with interactive prompts
- `ahk build` - Regenerate configuration files from the config file
- `ahk dashboard` - Open the local web dashboard for task management 
- `ahk status` - Show current tasks and active agent actions
- `ahk health` - Run the project's health check
- `ahk sync` - Synchronize tasks between JSON and SQLite backends
- `ahk serve` - Start the MCP server (launched automatically by AI tools)
- `ahk task add` - Add new tasks interactively to the backlog
- `ahk task list` - List all tasks by status 
- `ahk task done` - Mark a task as completed
- `ahk migrate` - Migrate configuration between AI providers
- `ahk export` - Export database content for backup/reporting

### Configuration Options

The kit is configured through `agent-harness-kit.config.ts` with:
- Project metadata and documentation paths
- Agent definitions and permissions
- Storage settings (database, file paths)
- Health check configurations
- Tool integration options

## Installation & Setup

1. Ensure Node.js ≥ 22 or Bun is installed
2. Add the package to your project:
   ```bash
   npm install --save-dev @cardor/agent-harness-kit
   ```
3. Initialize with:
   ```bash
   npx ahk init
   ```

## Best Practices

1. **Task Definition**: Create detailed task descriptions with clear acceptance criteria
2. **Health Checks**: Implement comprehensive health checks that reflect real project needs 
3. **Agent Instructions**: Customize agent roles with domain-specific context
4. **Audit Trail**: Utilize all available logging sections for visibility
5. **Workflow Adherence**: Follow the defined sequence (Lead → Explorer → Builder → Reviewer)

## Security Considerations

- The system uses a sandboxed approach to file operations
- All file I/O is restricted by configured paths for each agent type
- No external API keys or cloud services are required beyond standard AI tooling
- Input validation ensures that only properly structured data is processed

## Limitations & Known Issues

- Requires Node.js ≥ 22 or Bun runtime environment
- Uses SQLite for local state management (not suitable for distributed environments)
- Agent interactions are synchronous and don't support real-time collaboration