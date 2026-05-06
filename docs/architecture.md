# Architecture Overview

## System Architecture

The agent-harness-kit is built on a structured multi-agent workflow that leverages the Model Communication Protocol (MCP) to coordinate AI agents in software development tasks. The system follows a defined pattern where each agent has distinct roles, responsibilities, and permissions.

### Core Principles

1. **Decomposition**: Tasks are broken down into atomic steps that can be handled by different agents
2. **Coordination**: A lead agent orchestrates the workflow between specialized agents
3. **Auditability**: Every action, file touched, and decision is logged and traceable
4. **Control**: Human-in-the-loop control through defined workflows and health checks
5. **Simplicity**: Clear separation of concerns without over-engineering

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           AI Agent Interface (MCP)                        │
├─────────────────────────────────┬───────────────────────────────────────────┤
│           Agent Tools         │     Agent Roles                          │
│  ┌─────────────┐    ┌─────────▼──────────┐    ┌─────────────┐            │
│  │   Tasks     │    │   Actions          │    │   Docs      │            │
│  │  - Get      │    │  - Start/Complete  │    │  - Search   │            │
│  │  - Claim    │    │  - Write/Read      │    │  - Indexes  │            │
│  │  - Update    └───┼─▶  - Log Sections  └───┼─▶  - Content  └───┐     │
│  └─────────────┘    │  - Get History       │    └───────────┘   │   │     │
│                     └─────────┬────────────┘                      │   │     │
│                               │                                   │   │     │
│                     ┌─────────▼────────────┐                        │   │     │
│                     │        DB             │                        │   │     │
│                     │  - SQLite Database    │                        │   │     │
│                     │  - Tasks & Actions   │                        │   │     │
│                     │  - Agent States        │                        │   │     │
│                     └─────────┬────────────┘                        │   │     │
│                               │                                   │   │     │
│                     ┌─────────▼────────────┐                        │   │     │
│                     │     File System     │                        │   │     │
│                     │  - Project Files        │                        │   │     │
│                     │  - Task Backlog          │                        │   │     │
│                     │  - Config Files          │                        │   │     │
│                     └─────────▲────────────┘                        │   │     │
│                               │                                   │   │     │
└───────────────────────────────┼───────────────────────────────────────────────────────┼─────┼─────┘
                                │                                           │     │
                      ┌─────────▼──────────┐                        │     │
                      │    Agent Roles       │                        │     │
                      │  - Lead              │                        │     │
                      │  - Explorer          │                        │     │  
                      │  - Builder            │                        │     │
                      │  - Reviewer           │                        │     │
                      └──────────────────────┘                        │     │
                                                                        │     │
                                                      ┌─────────────────┴─────┴─────────┐
                                                      │        Local Files               │
                                                      │    ┌─────────────────────────┐   │
                                                      │    │  - health.sh             │   │
                                                      │    │  - AGENTS.md             │   │
                                                      │    │  - feature_list.json     │   │
                                                      │    │  - agent-harness-kit.config.ts│   │
                                                      │    └─────────────────────────┘   │
                                                      └──────────────────────────────────┘

```

## Component Diagram

### 1. Agent Roles (Core System Components)

#### Lead Agent
The lead agent orchestrates the entire workflow for a task, managing the sequence between exploration and implementation.

**Key Responsibilities:**
- Claims tasks from the backlog
- Coordinates the three-step workflow (Explore → Build → Review) 
- Ensures proper handoffs between agents
- Manages session state and completion

**Technical Details:**
- Works with `tasks.claim()` to secure work
- Uses `actions.start()` and `actions.complete()` for session management  
- Relies on `tasks.get('in_progress')` and `tasks.get('pending')` for task awareness
- Ensures proper sequence flow between agents

#### Explorer Agent 
Responsible for analyzing the codebase without making changes.

**Key Responsibilities:**
- Reads and maps codebase files relevant to a task
- Identifies existing patterns, constraints, and implementation details
- Produces structured analysis for the builder agent
- Searches documentation using `docs.search()`

**Technical Details:**
- Works only with read permissions
- Logs every file read via `actions.write('tools_used')`
- Never modifies files directly
- Uses `docs.search()` to find project documentation

#### Builder Agent
Implements solutions according to the lead's plan and explorer's analysis.

**Key Responsibilities:**
- Implements code changes exactly as planned
- Works within defined writable paths
- Follows all codebase patterns and conventions
- Runs tests after implementation

**Technical Details:**
- Only writes to designated writable paths
- Logs every file modified via `actions.write('files_modified')`
- Maintains focus on scope - no "while I'm here" refactors
- Ensures tests pass before completing actions

#### Reviewer Agent
Verifies that all acceptance criteria are met.

**Key Responsibilities:**
- Reviews all implementation against acceptance criteria
- Runs health checks before finalizing work
- Approves or blocks tasks with specific feedback
- Ensures quality and consistency

**Technical Details:**
- Reviews all three key action sections (lead's plan, explorer's analysis, builder's implementation)
- Enforces strict adherence to defined acceptance criteria
- Blocks when criteria not met rather than guessing
- Runs health checks as part of approval process

### 2. Data Storage Layer

#### SQLite Database (.harness/harness.db)
The SQLite database stores all state information for the agent harness in a structured way:

**Key Tables:**
1. **tasks** - Project tasks and their status
   - `id`, `slug`, `title`, `description`, `acceptance`, `status`
   - Tracks task lifecycle from pending to done

2. **actions** - Individual actions taken during task execution
   - `id`, `taskId`, `agent`, `startedAt`, `completedAt` 
   - Records detailed activity logs

3. **sections** - Log entries for each action
   - `actionId`, `sectionType`, `content`
   - Stores different types of information: results, blockers, files modified

4. **files** - File operations and metadata
   - Tracks which files were touched by each agent

#### Files System
- `.harness/harness.db` - Main SQLite database file
- `.harness/feature_list.json` - Human-editable task backlog
- `.harness/current.md` - Auto-generated session snapshot (for non-MCP environments)
- `health.sh` - Custom health check script
- `agent-harness-kit.config.ts` - Core project configuration

### 3. Interaction Patterns

#### Task Lifecycle
1. **Task Initiation**: Lead claims a task from the backlog
2. **Planning Phase**: Lead defines plan in actions.start()
3. **Execution Phase**: Explorer analyzes, Builder implements, Reviewer verifies
4. **Completion**: Reviewer approves or blocks with specific feedback

#### Communication Protocol
Agents interact through:
- `tasks.get()` - Retrieve tasks by status
- `tasks.claim()` - Atomically claim a task (prevents race conditions)
- `actions.start()` / `actions.complete()` - Register and complete actions  
- `actions.write()` - Log information about the action
- `docs.search()` - Search project documentation

#### Data Flow
1. **Initiation**: Lead runs health check, claims task, starts with actions.start()
2. **Planning**: Lead defines requirements in 'result' section  
3. **Exploration**: Explorer reads files, logs to 'tools_used'
4. **Implementation**: Builder implements, logs to 'files_modified'
5. **Review**: Reviewer checks all evidence, approves or blocks
6. **Closure**: Task status updated and health check re-run

## Configuration System

The configuration system allows for flexible customization:

### Main Configuration File (agent-harness-kit.config.ts)
```typescript
import { defineHarness } from '@cardor/agent-harness-kit'

export default defineHarness({
  project: {
    name: 'My App',
    description: 'What this project does',
    docsPath: './docs',
  },
  provider: 'claude-code', // or 'opencode'
  agents: {
    lead:     { instructionsPath: null },
    explorer: { instructionsPath: null, allowedPaths: ['./docs', './src'] },
    builder:  { instructionsPath: null, writablePaths: ['./src', './tests'] },
    reviewer: { instructionsPath: null },
    custom:   [], // Define additional agents here
  },
  storage: {
    dir: '.harness',
    dbPath: '.harness/harness.db',
    tasks: { adapter: 'local' },
    sections: {
      toolsUsed: true,        // log which tools agents used
      filesModified: true,    // log which files were touched
      result: true,           // log action results
      blockers: true,         // log blockers
      nextSteps: false,       // optional next steps field
    },
    markdownFallback: { enabled: true, path: '.harness/current.md' },
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

## Implementation Details

### Workflow Orchestration
The system ensures that workflow steps are followed through:
1. **Initialization**: Health check runs to ensure environment readiness 
2. **Task Selection**: The Lead agent selects from pending tasks
3. **Task Execution**: 
   - Explorer maps codebase (reads files, logs activity)
   - Builder implements solutions (writes files, logs changes)  
   - Reviewer validates against acceptance criteria and health checks
4. **Session Closure**: Tasks are marked done after final approval

### File System Security Model
Each agent is restricted to specific file system operations:
- **Lead/Reviewer**: Read-only access to codebase
- **Explorer**: Read-only with documentation search capability
- **Builder**: Read/Write within designated paths, read-only elsewhere

### Health Checks and Validation
The system enforces quality through automated validation:

1. **Pre-Action Health**: Run before starting tasks
2. **Post-Approval Health**: Ensures codebase remains healthy after work
3. **Custom Scripts**: Pluggable health checking via `health.sh`

## Integration Points

### With AI Tools
The system integrates with MCP-compatible AI tools through:
- Standardized tool interface for all operations
- Consistent task/state management
- Predictable data flow patterns

### With Local Development Environments  
- No external dependencies beyond Node.js/Bun runtime
- SQLite for state persistence without database setup
- File-based configuration that's human-readable

## Security Considerations

1. **File System Isolation**: Agents can only access designated paths
2. **Process Isolation**: Each agent action runs in isolated context
3. **Input Validation**: All operations go through the MCP protocol  
4. **Execution Control**: No arbitrary code execution allowed

This architecture ensures that the system is:
- **Predictable** through well-defined roles and responsibilities 
- **Auditable** with comprehensive logging of all activities
- **Scalable** by allowing additional agents or configurations
- **Maintainable** with clear separation between configuration, logic, and data