# Implementation Guide

This document provides detailed implementation information for developers and maintainers working with the agent-harness-kit. It covers installation, architecture, configuration, usage patterns, and troubleshooting.

## System Requirements

### Software Dependencies
- **Node.js**: Version 22 or higher (uses `node:sqlite` built-in)
- **Alternative runtimes**: Bun (any recent version) - uses `bun:sqlite` built-in  
- **Package Manager**: npm ≥ 9 or pnpm ≥ 8 (for development)

### Hardware Requirements
The system is lightweight and can run on standard developer workstations. Minimal resource usage ensures it can run on any machine with Node.js or Bun installed.

## Installation & Setup

### Prerequisites
Before installing the agent-harness-kit, ensure you have:

1. **Node.js** ≥ 22 or **Bun** (any recent version) installed  
2. A package manager like npm ≥ 9 or pnpm ≥ 8
3. Git for version control support

### Installation Process

#### As Development Dependency
```bash
# Using npm
npm install --save-dev @cardor/agent-harness-kit

# Using pnpm  
pnpm add -D @cardor/agent-harness-kit

# Using Bun
bun add -d @cardor/agent-harness-kit
```

#### Global Installation (Alternative)
```bash
# Install globally for command-line use
npm install -g @cardor/agent-harness-kit
```

### Initial Setup with `ahk init`

The system provides an interactive setup process through the CLI:

```bash
npx ahk init
```

This will:
1. Prompt for project metadata and configuration
2. Create necessary agent definition files
3. Generate task backlogs and documentation paths  
4. Set up the SQLite database file
5. Configure health check scripts

### Quick Start Example

```bash
# Initialize a new harness in your project
mkdir my-project && cd my-project
npx ahk init

# Or extend an existing project
cd /path/to/existing/project
npx ahk init --name "My Cool App"

# The setup will create:
# - .harness/harness.db          # SQLite database for workflow state
# - .harness/feature_list.json   # Task backlog in JSON format  
# - AGENTS.md                    # Generated agent navigation map
# - health.sh                    # Customizable health check script
# - agent-harness-kit.config.ts  # Core configuration file
```

## Configuration Reference

### Main Configuration File

The primary configuration file is `agent-harness-kit.config.ts`:

```typescript
import { defineHarness } from '@cardor/agent-harness-kit'

export default defineHarness({
  project: {
    name: 'My Project Name',
    description: 'What this project does',
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
    custom: [], // Define additional agents here
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
    markdownFallback: { 
      enabled: true, 
      path: '.harness/current.md' 
    },
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

### Customizing Agent Definitions

Agent behaviors are defined in markdown files located in the provider directory:

#### Lead Agent Configuration
```markdown
---
name: lead
description: >
  Use this agent to orchestrate a full task from the harness backlog.
  ...
---

# Lead Agent — {{projectName}}

You are the **lead agent** for `{{projectName}}`. Your job is to orchestrate the harness workflow...

## Responsibilities

- Pick and claim exactly one task per session
- Decompose it into a clear plan for the other agents  
- Delegate in the correct order: Explorer → Builder → Reviewer
- Re-coordinate if the Reviewer blocks (send back to Builder with specific issues)
- Close the session cleanly when the task is done

## Hard rules

- One task at a time. Never pick a second task while one is in progress.
- You do not write code. Delegate all implementation to Builder.
- You do not read source files. Delegate all analysis to Explorer.
- Never mark a task done without reviewer approval.
```

### Custom Agent Templates

The system allows for customizing templates for each agent role through the configuration:

1. Create a directory structure:
```bash
mkdir -p .claude/agents
```

2. Customize the agent instruction files to match your specific domain requirements.

## Command Line Interface (CLI)

The CLI provides a complete interface for managing workflows and tasks:

### Core Commands

#### `ahk init`
Interactive setup command:
```bash
# Standard interactive setup  
ahk init

# Non-interactive setup with flags
ahk init --name "My Project" \
        --provider claude-code \
        --docs ./docs \
        --tasks local
```

#### `ahk build`
Regenerates configuration files from the main config:
```bash
ahk build                    # Build all components
ahk build --watch           # Watch for changes and rebuild automatically
```

#### `ahk dashboard` 
Opens the web dashboard in your browser:
```bash
ahk dashboard                 # Opens http://localhost:4242 
ahk dashboard --port 8080    # Custom port
ahk dashboard --no-open      # Start without opening browser
```

#### `ahk status`
Shows current task and agent status:
```bash
ahk status                    # Basic status
ahk status --json            # Machine-readable output  
```

#### `ahk health` 
Runs the project's health check:
```bash
ahk health                   # Run health check
```

#### `ahk sync`
Synchronizes task backlogs between JSON and database:
```bash  
ahk sync                     # Bidirectional sync
ahk sync --direction in     # Import from JSON only
ahk sync --direction out    # Export to JSON only
ahk sync --dry-run           # Preview changes without applying
```

#### `ahk serve`
Starts the MCP server:
```bash
ahk serve                   # Start MCP server (auto-spawned by AI tools)
ahk serve --port 3456      # Specify custom port for MCP
```

#### `ahk task add`
Adds new tasks to the backlog:
```bash
ahk task add                # Interactive addition
```

#### `ahk task list`  
Lists all tasks with filtering options:
```bash
ahk task list               # All tasks
ahk task list --status pending   # Filter by status
ahk task list --json           # Machine-readable output
```

#### `ahk task done`
Marks a task as completed:
```bash
ahk task done 3              # By ID
ahk task done add-auth-flow  # By slug  
```

#### `ahk migrate`
Migrates between provider configurations:
```bash
ahk migrate --to opencode   # Migrate to OpenCode
ahk migrate --to claude-code # Migrate to Claude Code
```

#### `ahk export` 
Exports database content for backup/reporting:
```bash
ahk export --json              # Export as JSON to stdout
ahk export --json --output dump.json  # Export to file
ahk export --sql               # Export SQL dump to stdout  
ahk export --sql --output dump.sql    # Export SQL to file
```

## File System Architecture

### Core Directories and Files

#### `.harness/` Directory 
This directory contains all runtime data:
- `harness.db` - SQLite database with tasks, actions, and logs  
- `feature_list.json` - Human-editable task backlog (version controlled)
- `current.md` - Auto-generated session snapshot for non-MCP environments  

#### Provider Configuration
The system supports two major providers:

1. **Claude Code** (`/.claude/`)
2. **OpenCode** (`/.opencode/`)

Each provider directory contains:
- Agent definition files (`.claude/agents/*.md` or `.opencode/agents/*.md`)
- MCP configuration file (`mcp.json`)

### Configuration File Structure

#### `agent-harness-kit.config.ts`
The main configuration file with all customizable settings. It includes:

1. **Project Metadata**
   - Name and description
   - Documentation path
2. **Provider Settings** 
   - AI provider selection (claude-code, opencode)
3. **Agent Definitions**
   - Permissions for each agent type
   - Allowed paths for each role
4. **Storage Configuration** 
   - Database location
   - Logging preferences
   - Fallback settings
5. **Health Settings**
   - Custom health script path
   - Health check enforcement

#### `health.sh` Script
The custom health check script is a critical component that must exit with status code 0 to indicate success:

```bash
#!/usr/bin/env bash

# Example health checks:
# Check Node.js version
node --version

# Run tests  
npm test || exit 1

# Verify database connection
pg_isready -d "$DATABASE_URL" || exit 1

echo "All checks passed."
```

## Database Schema Design

The SQLite database maintains the complete workflow state with a normalized schema:

### Tasks Table
```sql
CREATE TABLE tasks (
    id INTEGER PRIMARY KEY,
    slug TEXT UNIQUE,
    title TEXT,
    description TEXT, 
    acceptance TEXT,
    status TEXT
);
```

### Actions Table  
```sql
CREATE TABLE actions (
    id INTEGER PRIMARY KEY,
    taskId INTEGER,
    agent TEXT,
    startedAt DATETIME,
    completedAt DATETIME
);
```

### Sections Table
```sql
CREATE TABLE sections (
    id INTEGER PRIMARY KEY,
    actionId INTEGER,
    sectionType TEXT,
    content TEXT
);
``### Files Table (for tracking file operations)
```sql
CREATE TABLE files (
    id INTEGER PRIMARY KEY, 
    actionId INTEGER,
    path TEXT,
    operation TEXT
);
```

## Development Workflow

### Setting Up a Development Environment

1. **Clone the repository**:
   ```bash
   git clone <repo-url>
   cd agent-harness-kit
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Build the project**:
   ```bash
   npm run build
   ```

4. **Link for development**:
   ```bash
   npm link
   ```

### Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run specific test files  
npm run test -- src/tests/
```

### Building the Dashboard UI

The dashboard is a separate React/TypeScript application:

```bash
# Build the dashboard UI
npm run build:ui

# Or for development with HMR
cd dashboard && npm run dev
```

## Common Use Cases & Examples

### Example 1: Adding a New Task

```bash
# Add a new task using interactive mode
ahk task add

# Or add directly via JSON (useful for automation)
echo '{
  "slug": "add-user-profile",
  "title": "Add User Profile Page", 
  "description": "Create user profile page with edit functionality",
  "acceptance": [
    "Page displays user information",
    "Edit form saves changes",
    "Validation is performed"
  ]
}' > new-task.json

# Sync to the database
ahk sync --direction in
```

### Example 2: Running a Full Cycle Workflow

1. **Start the dashboard** to observe workflow:
   ```bash
   ahk dashboard
   ```

2. **Initialize with a task**:
   ```bash
   ahk init --name "My Project" --provider claude-code
   ```

3. **Run health checks** to ensure stability:
   ```bash
   ahk health
   ```

4. **Monitor the workflow** through the dashboard or CLI.

### Example 3: Customizing Agent Behavior

To extend agent capabilities, you can create custom instructions by modifying:

1. **Agent Instructions**
```bash
# Edit agent files directly in .claude/agents/ or .opencode/agents/
# For example, modify the builder's behavior:
```

2. **Configuration File**
Update `agent-harness-kit.config.ts` to adjust:
- Writable paths for the Builder agent
- Allowed paths for the Explorer agent  
- Documentation search paths

## Troubleshooting Guide

### Common Issues and Solutions

#### Issue 1: Health Check Fails
**Symptoms**: `ahk health` command fails with error
**Solution**: 
```bash
# Check your health.sh script directly
./health.sh
# Fix any failing commands in the script
```

#### Issue 2: Database Access Problems  
**Symptoms**: "Database connection failed" errors
**Solution**:
```bash
# Verify database file exists and has correct permissions
ls -la .harness/harness.db
# Check that the file is readable/writable by current user
```

#### Issue 3: Agent Claims Conflicts 
**Symptoms**: "Task already claimed" errors
**Solution**:
1. Check if another agent session is running
2. Wait for tasks to clear automatically
3. Manually clear stuck sessions if needed

#### Issue 4: File Access Denied
**Symptoms**: Builder/Explorer agents cannot access files
**Solution**:
```bash
# Verify file permissions and paths in config
# Check that writablePaths are correctly defined
# Ensure no path conflicts or typos
```

### Performance Optimization Tips

1. **Database Maintenance**: Regular cleanup of old tasks to maintain performance
2. **Configuration**: Optimize agent paths to reduce unnecessary file operations  
3. **Health Checks**: Keep health check scripts efficient (avoid heavy operations)
4. **Caching**: Use local caching where appropriate for common operations

### Security Considerations

1. **File System Isolation**: Agents can only access designated directories
2. **Process Isolation**: Prevents unauthorized file system access through agents
3. **Access Controls**: Role-based permissions for all operations  
4. **Input Validation**: All external inputs are validated before processing

## Release Management

### Versioning Strategy
The project follows [Semantic Versioning](https://semver.org/) principles:
- **Major versions** indicate breaking changes
- **Minor versions** add features without breaking existing workflows  
- **Patch versions** fix issues in existing functionality

### Release Process
1. **Development**: Feature branches with atomic commits
2. **Testing**: All tests must pass before merge
3. **Release Build**: Generate new versions with changelogs
4. **Documentation**: Update docs for new features or breaking changes

This implementation guide provides everything needed to get started with the agent-harness-kit, enabling developers to quickly understand, set up, and customize the system for their projects.