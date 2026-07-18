# Agent Harness Kit Documentation

## Overview

The agent-harness-kit is a provider-agnostic scaffolding solution for running structured, coordinated multi-agent workflows in codebases. It provides a framework where AI agents can work together systematically through defined roles with specific responsibilities.

## Key Features

- **Provider Agnostic**: Works with Claude Code, OpenCode, or any MCP-compatible AI tool
- **Structured Workflow**: Implements a multi-agent workflow (Lead, Explorer, Consultant (conditional), Builder, Reviewer) 
- **Task Management**: Provides a task backlog with acceptance criteria
- **Audit Trail**: Full logging of every action, file modification, and tool usage
- **Health Checks**: Ensures code quality through configurable health checks
- **No External Dependencies**: Uses SQLite for local state management without external services

## Architecture Overview

```
AI Tool (Claude Code/OpenCode) 
        ↓
MCP Protocol → Agent Harness Kit (Node.js/Bun)
        ↓
  Task Management System  
        ↓
SQLite Database (Tasks, Actions, Logs)
        ↓
Agent Roles: Lead → Explorer → Consultant (conditional) → Builder → Reviewer
```

### Core Components

1. **Task System**: Manages the full lifecycle of development tasks
2. **Agent Roles**: Five roles with defined responsibilities (consultant is conditional)
3. **Action Logging**: Comprehensive audit trail for all activities  
4. **File System Interface**: Controlled access to project files
5. **Health Checks**: Quality gate enforcement
6. **Configuration System**: Flexible setup via config file

## Getting Started

### Prerequisites
- Node.js ≥ 22 or Bun (any recent version)
- npm ≥ 9 or pnpm ≥ 8

### Installation

```bash
# Install in your project as a dev dependency
npm install --save-dev @cardor/agent-harness-kit

# Or globally for CLI access
npm install -g @cardor/agent-harness-kit
```

### Quick Start

```bash
# Initialize in your project
npx ahk init

# Follow interactive prompts to configure your workflow
```

## Core Concepts

### The Agent Roles

#### Lead Agent
- **Primary Responsibility**: Orchestrator and coordinator
- **Duties**: Decomposes tasks, claims work, manages workflow sequence
- **Key Actions**: Task claiming, plan creation, session coordination

#### Explorer Agent  
- **Primary Responsibility**: Codebase analysis and mapping
- **Duties**: Reads source files, identifies patterns, documents constraints
- **Key Actions**: File reading, documentation search, analysis creation

#### Consultant Agent (conditional)
- **Primary Responsibility**: Technical advisory
- **Duties**: Provides structured advisory on patterns, risks, and best practices; runs deps tools
- **Key Actions**: Code reading, `deps.check`, writing advisory to harness via `actions.write`
- **Invoked when**: dependency changes detected, first task of session, or task touches config/deps

#### Builder Agent
- **Primary Responsibility**: Implementation and task execution  
- **Duties**: Writes code changes, implements solutions, maintains quality
- **Key Actions**: File modification, test execution, implementation

#### Reviewer Agent
- **Primary Responsibility**: Quality control and validation
- **Duties**: Verifies acceptance criteria, approves work, blocks when needed
- **Key Actions**: Validation, health checks, approval/blocking

### Task Lifecycle

1. **Task Creation**: Tasks added to backlog via feature_list.json or CLI
2. **Task Selection**: Lead agent selects and claims pending tasks
3. **Workflow Execution**: 
   - Lead → Explorer (analysis) → Consultant (advisory, conditional) → Builder (implementation) → Reviewer (approval)
4. **Task Completion**: Approved through health checks and quality gates

## Configuration

### Main Configuration File

`agent-harness-kit.config.ts`
```typescript
import { defineHarness } from '@cardor/agent-harness-kit'

export default defineHarness({
  project: {
    name: 'My Project',
    description: 'A project using agent harness kit',
    docsPath: './docs',
  },
  provider: 'claude-code', // or 'opencode'
  agents: {
    lead: { instructionsPath: null },
    explorer: { 
      instructionsPath: null, 
      allowedPaths: ['./docs', './src'] 
    },
    builder: { 
      instructionsPath: null, 
      writablePaths: ['./src', './tests'] 
    },
    reviewer: { instructionsPath: null },
  },
  // `database` never carries a file path — physical location is a `storage`
  // concern (see `storage.sqlitePath` below), not a `database` one.
  database: { type: 'sqlite' },
  storage: {
    dir: '.harness',
    tasks: { adapter: 'local' },
    sections: {
      toolsUsed: true,
      filesModified: true, 
      result: true,
      blockers: true,
      nextSteps: false
    },
    // scope: 'local' (shown here) — sqlitePath and markdownFallback.path are
    // only valid under this scope. Defaults to '.harness/harness.db' when
    // sqlitePath is omitted.
    markdownFallback: { enabled: true, path: '.harness/current.md' },
    scope: 'local',
    projectId: '5f2c...', // UUID, generated once at init, never regenerated
    // sqlitePath: '.harness/harness.db', // optional override
  },
  health: {
    scriptPath: './health.sh',
    required: true,
  },
  tools: {
    mcp: { enabled: true, port: 3456 },
    scripts: { enabled: true, outputDir: './.harness/scripts' },
  },
})
```

> `scope: 'global'` moves the DB (and current.md fallback) under
> `~/.harness/dbs/<projectId>/`, outside the project tree. Under that scope,
> `sqlitePath` and `markdownFallback.path` don't exist on the type at all —
> `storage: { ..., markdownFallback: { enabled: true }, scope: 'global',
> projectId: '5f2c...' }` (no `path`, no `sqlitePath`). See
> [architecture.md](./architecture.md) for the full discriminated-union shape.

### Health Checks

The system includes a health check mechanism to ensure code quality:

`health.sh`
```bash
#!/usr/bin/env bash
# Example health check script
echo "Running comprehensive health checks..."

# Add your project-specific checks here
# Should exit 0 for success, non-zero for failure
node --version
npm test || exit 1

echo "All health checks passed."
```

## Usage Patterns

### Task Management

Tasks are defined in `feature_list.json` and can be managed via CLI:

```bash
# Add a new task
ahk task add

# List all tasks  
ahk task list

# Complete a task (when approved)
ahk task done <task-id>
```

### Agent Workflows

Each agent follows a specific workflow pattern:

#### For the Lead Agent:
1. Check health status 
2. Claim a pending task
3. Start action and document initial plan
4. Delegate work to other agents in sequence
5. Complete session when task is finished

#### For the Explorer Agent:
1. Read lead's plan for the task
2. Map codebase files that are relevant  
3. Document findings clearly
4. Log all file reads for audit trail

#### For the Builder Agent:
1. Read full action history (lead's plan, explorer's analysis)
2. Implement changes following established patterns
3. Log every file modified
4. Run tests after implementing changes

#### For the Reviewer Agent:
1. Review lead's plan and explorer's analysis  
2. Verify builder's implementation matches requirements
3. Run health checks before final approval
4. Approve or block with specific feedback

## File Structure

```
project/
├── agent-harness-kit.config.ts   # Core configuration
├── health.sh                     # Health check script  
├── .harness/                     # Harness data directory
│   ├── harness.db               # SQLite database
│   ├── feature_list.json        # Task backlog (git-ignored)
│   └── current.md               # Session snapshot (git-ignored)
├── .claude/                      # Claude Code configuration  
│   └── agents/
│       ├── lead.md              # Lead agent instructions
│       ├── explorer.md          # Explorer agent instructions  
│       ├── builder.md           # Builder agent instructions
│       └── reviewer.md          # Reviewer agent instructions
└── .opencode/                    # OpenCode configuration (if applicable)
    └── agents/
        ├── lead.md
        ├── explorer.md
        ├── builder.md
        └── reviewer.md
```

## Command Reference

### Core Commands
```bash
# Initialize the harness
ahk init                          # Interactive setup  

# Manage tasks
ahk task add                      # Add new task interactively
ahk task list                     # List all tasks
ahk task done <id>             # Mark task complete

# Monitor workflow  
ahk status                        # Show current state
ahk health                        # Run system health check
ahk dashboard                     # Open web dashboard (http://localhost:4242)

# Configure and maintain
ahk build                         # Regenerate config from config file
ahk sync                          # Sync tasks with JSON file
ahk migrate --to claude-code     # Switch provider configurations  
```

## Best Practices

### For Developers

1. **Task Definition**: Create clear, specific tasks with defined acceptance criteria
2. **Health Checks**: Keep health check scripts lightweight and fast
3. **Documentation**: Maintain up-to-date project documentation for agents to reference
4. **File Access**: Respect file system restrictions on agent roles
5. **Audit Trail**: Maintain detailed logs for all changes

### For Project Maintainers

1. **Configuration Management**: Regularly update configuration files to reflect codebase changes
2. **Agent Behavior**: Customize agent instructions for your specific domain
3. **Health Checks**: Tailor health checks to actual project requirements  
4. **Task Backlog**: Keep feature_list.json updated with current priorities
5. **Monitoring**: Use dashboard for visibility into team productivity and bottlenecks

### For CI/CD Integration

1. **Pre-deployment Validation**: Use system's built-in health checks
2. **Workflow Automation**: Integrate with existing CI/CD pipelines
3. **Status Reporting**: Leverage dashboard for reporting workflow status
4. **Rollback Safety**: Ensure all changes are reversible through the task system

## Security Considerations

1. **File System Isolation**: Agents can only access designated paths
2. **Process Isolation**: Controlled execution environments prevent unintended operations  
3. **Input Validation**: All user inputs are validated before processing
4. **Data Integrity**: Complete audit trail of all activities
5. **Access Controls**: Role-based permissions for different agent types

## Troubleshooting

### Common Issues and Solutions

1. **Health Check Fails**: Verify your `health.sh` script executes successfully
2. **Task Claiming Conflicts**: Ensure no two agents are working on the same task  
3. **File Access Denied**: Check that agent roles have permission for designated directories
500. **Database Connection Issues**: Verify `.harness/harness.db` file permissions

### Performance Tips

1. **Optimize Health Checks**: Keep them fast to avoid workflow delays
2. **Efficient Task Definition**: Create granular tasks to prevent scope creep
3. **Database Maintenance**: Regular cleanup of old or unused data

## Contributing

The agent-harness-kit is designed to be extensible and maintainable. Contributions are welcome through GitHub issues and pull requests.

For development setup:
```bash
git clone <repo-url>
npm install
npm run build       # Build the dashboard and core package
npm run dev         # Development watch mode
```

## Compatibility

- **Node.js**: ≥ 22 (uses `better-sqlite3` native SQLite driver)
- **Bun**: Any recent version (uses `bun:sqlite` built-in)  
- **Browser**: None - requires Node.js or Bun runtime
- **Operating Systems**: Linux, macOS, Windows (through WSL)

## Roadmap

1. **OpenTelemetry Integration**: Distributed tracing for enhanced observability
2. **Cloud Task Adapters**: Jira, Linear, GitHub Issues integration
3. **Enhanced Dashboard Features**: Advanced analytics, real-time collaboration  
4. **Improved Agent Tools**: More sophisticated agent orchestration capabilities
5. **Plugin Ecosystem**: Extendable architecture for custom tools and integrations

This documentation provides a comprehensive overview of the agent-harness-kit system. For detailed implementation information, refer to the code comments and specific component documentation.