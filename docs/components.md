# Component Reference

## Core System Components

### 1. Task Management System

The task management system is the foundation of the agent-harness-kit architecture, providing a structured way to organize, track, and execute development work through a backlog of well-defined tasks.

#### Task Lifecycle
- **Pending**: New tasks awaiting assignment
- **In Progress**: Currently being worked on by an agent  
- **Done**: Successfully completed tasks
- **Blocked**: Tasks that cannot proceed due to dependencies or issues

#### Task Structure
Each task in the system has:
```
{
  "id": "unique_identifier",
  "slug": "task-slug-name", 
  "title": "Clear task title",
  "description": "Detailed task description",
  "acceptance": [
    "Acceptance criterion 1",
    "Acceptance criterion 2" 
  ],
  "status": "pending | in_progress | done | blocked"
}
```

#### Task Backlog
Tasks are managed in `.harness/feature_list.json` and can be:
- Added manually via `ahk task add`
- Synced between JSON and SQLite backends using `ahk sync`
- Viewed through CLI with `ahk task list`
- Manually marked as done with `ahk task done`

### 2. Agent Roles System

The system implements a comprehensive multi-agent workflow where each role has distinct responsibilities:

#### Lead Agent
**Primary Responsibility**: Orchestrator and coordinator
- Decomposes high-level tasks into actionable work for other agents
- Manages the sequential workflow between agents
- Claims tasks from the backlog using atomic operations
- Coordinates handoffs and manages session state

**Key Features**:
- Atomic task claiming to prevent race conditions
- Execution flow control through the agent sequence  
- Session state management
- Proper handoff protocols between roles

#### Explorer Agent
**Primary Responsibility**: Codebase analysis and mapping
- Reads source code files systematically without modifying them
- Documents existing patterns, constraints, and implementation details
- Searches project documentation for context and guidance
- Creates structured analysis for the builder agent

**Key Features**:
- Read-only access to codebase
- Comprehensive file logging via `tools_used` section
- Documentation search capabilities
- Pattern identification and constraint documentation

#### Builder Agent  
**Primary Responsibility**: Implementation and task execution
- Implements solutions based on lead's plan and explorer's analysis
- Works exclusively within pre-defined writable paths
- Makes targeted, purposeful code changes
- Maintains code quality through test verification

**Key Features**:
- Controlled file system write access
- Implementation logging with `files_modified` section
- Test execution after each meaningful change
- Strict scope adherence to prevent scope creep

#### Reviewer Agent
**Primary Responsibility**: Quality control and validation
- Validates implementation against all acceptance criteria
- Runs comprehensive health checks before approval
- Provides specific feedback for rework when needed
- Makes final go/no-go decisions on task completion

**Key Features**:
- Complete verification of all task requirements
- Mandatory pre-approval health checks
- Detailed block/feedback mechanisms 
- Strict adherence to defined approval criteria

### 3. Action Management System

Actions represent the fundamental unit of work within each agent's session, tracking activities through a structured logging system.

#### Action Lifecycle
1. **Start**: `actions.start(taskId, 'agent_role')` - Initializes an action
2. **Log**: `actions.write(sectionType, content)` - Records various types of information 
3. **Complete**: `actions.complete(actionId, summary)` - Finalizes the action

#### Available Section Types
- **result**: Primary output and findings from actions  
- **tools_used**: Tools invoked during the action (logging files read)
- **files_modified**: Files touched/changed during implementation
- **blockers**: Issues that prevented progress or completion
- **next_steps**: Suggested next steps or future work

### 4. Documentation System

The documentation system provides context and guidance to agents through structured content accessible via the docs.search tool.

#### Documentation Structure  
```
docs/
├── api-guides/
├── architecture/
├── conventions/ 
└── patterns/
```

#### Search Capabilities
Agents can query project documentation using:
```javascript
const results = await docs.search('error handling in TypeScript');
// Returns array of relevant document snippets
```

### 5. Health Check System

The health check system ensures consistent state and codebase quality by running predefined tests before and after operations.

#### Health Script Interface
```bash
#!/usr/bin/env bash

# Example health.sh script content
echo "Running comprehensive health checks..."

# Check node environment
node --version

# Run tests 
npm test || exit 1

# Verify database connection  
pg_isready -d "$DATABASE_URL" || exit 1

echo "All health checks passed."
exit 0
```

#### System Integration
- Runs automatically at task start and completion
- Prevents working with unstable environments
- Configurable to match project requirements
- Fails fast when issues are detected  

### 6. Configuration Engine

The configuration system provides a flexible way to customize behavior without code changes.

#### Key Configuration Areas

**Project Metadata**
```typescript
project: {
  name: 'Project Name',
  description: 'What this project does',
  docsPath: './docs'
}
```

**Agent Definitions**
Each agent can have custom settings:
- `instructionsPath`: Path to agent-specific instructions
- `allowedPaths`: Files/areas explorer is allowed to examine  
- `writablePaths`: Directories builder is allowed to write to

**Storage Settings**
```typescript
storage: {
  dir: '.harness',
  dbPath: '.harness/h harness.db',
  tasks: { adapter: 'local' },
  sections: {
    toolsUsed: true,
    filesModified: true, 
    result: true,
    blockers: true,
    nextSteps: false
  },
  markdownFallback: { enabled: true, path: '.harness/current.md' }
}
```

**Health Configuration**
```typescript
health: {
  scriptPath: './health.sh',
  required: true
}
```

### 7. File System Interface

The file system interface provides secure, controlled access to project files for agents.

#### Security Model
- **Lead/Reviewer**: Read-only access to source code 
- **Explorer**: Read access and documentation search capabilities  
- **Builder**: Controlled write access within designated paths

#### File Operations Logging
All file operations are logged:
- Files opened by explorer: `actions.write('tools_used', 'file:///path/to/file')`
- Files modified by builder: `actions.write('files_modified', 'src/core/service.ts')` 

### 8. Dashboard & Visualization

The dashboard provides real-time monitoring and historical analysis capabilities.

#### Key Dashboard Features
- **Overview**: Task status summary, active agent activity
- **Task Detail View**: Full action history for individual tasks  
- **Agents Summary**: Agent performance and activity tracking
- **Tools Log**: Tool usage analysis and trends
- **Files Activity**: Operation breakdown by file type

### 9. Command Line Interface (CLI)

The CLI provides command-line access to all core system functionality.

#### Key Commands

**Task Management**
```bash
# Initialize new harness
ahk init

# Add new tasks  
ahk task add

# List existing tasks
ahk task list

# Mark task done
ahk task done <id|slug>
```

**System Operations** 
```bash
# Run health check
ahk health  

# View current status
ahk status

# Open dashboard
ahk dashboard

# Export system state  
ahk export

# Migrate between providers
ahk migrate
```

#### Configuration Options
- `--help` - Display command usage
- `--verbose` - Verbose output mode
- `--json` - Machine-readable output format
- `--dry-run` - Preview changes without applying

### 9. Data Persistence Layer

The SQLite database provides a local, lightweight persistence layer that handles all workflow state.

#### Database Schema
```
tasks: (
  id INTEGER PRIMARY KEY,
  slug TEXT UNIQUE,
  title TEXT,
  description TEXT,
  acceptance TEXT,
  status TEXT
)

actions: (
  id INTEGER PRIMARY KEY,
  taskId INTEGER,
  agent TEXT,
  startedAt DATETIME,
  completedAt DATETIME
)

sections: (
  id INTEGER PRIMARY KEY,
  actionId INTEGER,
  sectionType TEXT,
  content TEXT
)

files: (  
  id INTEGER PRIMARY KEY,
  actionId INTEGER,
  path TEXT,
  operation TEXT  -- read/write/modify
)
```

### 10. Integration Points

#### External System Integrations
- **CI/CD Pipelines**: Health checks integrate with standard continuous integration workflows
- **Project Documentation**: Native support for documentation search and indexing  
- **Development Tools**: Compatible with any MCP-compatible AI assistant
- **Version Control**: Git-friendly with no hidden files or state

#### API Consistency
All interactions follow REST-like principles:
- `GET`/`POST`/`PUT` style operations
- Consistent error handling and response patterns
- Predictable data models and structures

This comprehensive component architecture enables the agent-harness-kit to provide a robust, scalable, and maintainable foundation for multi-agent development workflows while maintaining simplicity of operation.