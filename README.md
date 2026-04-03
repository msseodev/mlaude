# mlaude

A Claude Code automation tool that queues multiple prompts for sequential execution with automatic rate limit handling and retry with exponential backoff.

## Features

### Manual Mode
- **Prompt Queue Management** — Drag-and-drop reordering, CRUD operations
- **Execution Plans** — Combine global and plan-level prompts into execution plans
- **Sequential Auto-Execution** — Execute queued prompts one by one via Claude Code CLI

### Autonomous Mode (Multi-Agent Pipeline)
- **Agent Pipeline** — UX/Tech/Biz Planners (parallel) → Planning Moderator → Developer → Reviewer → QA Engineer
- **Pipeline Branching** — discovery/fix/test_fix pipelines (skip unnecessary agents per cycle type)
- **Test Engineer** — Specialized agent for Flutter/Dart test fixes
- **Parallel Processing** — Worker pool processes multiple findings simultaneously via git worktrees
- **CEO Escalation** — Agents can request human decisions; responses are injected into subsequent cycles
- **Discord Integration** — CEO requests sent to Discord with thread-based replies
- **Watchdog** — Hourly health check via separate Opus session to detect and kill stuck cycles
- **Mid-Session Prompts** — Inject new instructions while autonomous mode is running
- **Global Prompt** — Shared instructions injected into all agents across all cycles
- **Prompt Evolution** — Automatic prompt mutation and scoring to improve agent performance over time
- **Custom Agents** — Define additional agents with custom system prompts and pipeline ordering
- **LLM Codebase Scanner** — Claude haiku analyzes project structure at session start
- **Built-in Commands** — Auto-synced Claude Code commands (`/mlaude-project-review`: 8-perspective parallel analysis with synthesized report)

### Shared
- **Automatic Rate Limit Handling** — Detects rate limits via exit codes, stream events, and text patterns; retries with exponential backoff (5min~40min)
- **Real-time Monitoring** — SSE-based streaming for live output and tool usage tracking
- **Execution History** — Stores cost, duration, and output logs in SQLite
- **Pause/Resume/Stop** — Queue control during execution

## Tech Stack

- **Frontend**: Next.js 16, React 19, Tailwind CSS 4
- **Backend**: Next.js API Routes (App Router)
- **DB**: better-sqlite3 (SQLite)
- **Unit Test**: Vitest
- **E2E Test**: Playwright

## Getting Started

```bash
# Install dependencies
npm install

# Start dev server
npm run dev
```

Access at http://localhost:51793.

## Project Structure

```
src/
├── app/
│   ├── api/           # API Routes (prompts, plans, run, history, settings, auto)
│   ├── auto/          # Autonomous mode pages (dashboard, findings, agents, cycles, etc.)
│   ├── chat/          # Chat interface page
│   ├── history/       # Execution history page
│   ├── plans/         # Execution plans page
│   ├── prompts/       # Prompt management page
│   ├── run/           # Execution monitoring page
│   └── settings/      # Settings page
├── components/
│   ├── layout/        # AppLayout
│   └── ui/            # Button, Badge, Modal, Toast
├── hooks/             # useRunStatus, useAutoStatus, useSSE
├── lib/
│   ├── autonomous/           # Autonomous mode engine
│   │   ├── cycle-engine.ts         # Cycle orchestrator (core loop)
│   │   ├── pipeline-executor.ts    # Multi-agent pipeline execution
│   │   ├── parallel-coordinator.ts # Worker pool for parallel finding processing
│   │   ├── watchdog.ts             # Hourly stuck-cycle detection
│   │   ├── agent-context-builder.ts # Agent prompt context assembly
│   │   ├── seed-agents.ts          # Built-in agent definitions
│   │   ├── finding-extractor.ts    # Extract findings from agent output
│   │   ├── prompt-evolver.ts       # Prompt mutation & scoring
│   │   ├── evolution-db.ts         # Prompt evolution DB layer
│   │   ├── screen-capture.ts       # App screenshot capture for planners
│   │   ├── git-manager.ts          # Git checkpoint/rollback
│   │   ├── state-manager.ts        # SESSION-STATE.md management
│   │   ├── phase-selector.ts       # Phase selection (v1 compat)
│   │   ├── prompt-builder.ts       # Phase-specific prompts (v1 compat)
│   │   ├── test-runner.ts          # Test execution & parsing
│   │   ├── command-runner.ts       # Shell command execution with timeout
│   │   ├── cycle-scorer.ts         # Cycle quality scoring
│   │   ├── output-parser.ts        # Structured output parsing
│   │   ├── summarizer.ts           # Output summarization & commit messages
│   │   ├── command-sync.ts          # Sync built-in commands to target project
│   │   ├── codebase-scanner.ts     # Project structure analysis (LLM-powered)
│   │   ├── user-prompt-builder.ts  # User prompt assembly
│   │   ├── db.ts                   # Autonomous mode DB layer
│   │   └── types.ts                # Autonomous mode types
│   ├── claude-executor.ts    # Claude CLI process management
│   ├── run-manager.ts        # Queue execution engine (singleton)
│   ├── stream-parser.ts      # stream-json parsing
│   ├── rate-limit-detector.ts # Rate limit detection
│   ├── db.ts                 # SQLite data layer
│   └── types.ts              # Type definitions
└── types/
tests/
├── unit/              # Vitest unit tests
└── e2e/               # Playwright E2E tests
```

## Scripts

```bash
npm run dev            # Dev server (http://localhost:51793)
npm run build          # Production build
npm run lint           # ESLint
npm test               # Unit tests
npm run test:watch     # Unit tests in watch mode
npm run test:e2e       # E2E tests
npm run test:e2e:headed # E2E tests (headed browser)
```

---

## API Guide for Claude Code

Base URL: `http://localhost:51793`

All examples use `curl`. Responses are JSON.

### 1. Settings — Configure Before Use

```bash
# Get current settings
curl http://localhost:51793/api/settings

# Set target working directory and global prompt
curl -X PUT http://localhost:51793/api/settings \
  -H 'Content-Type: application/json' \
  -d '{
    "working_directory": "/path/to/your/project",
    "global_prompt": "Follow TDD. Write tests first.",
    "claude_binary": "claude"
  }'
```

- `working_directory` — default working directory for prompts that don't specify their own
- `global_prompt` — prepended to every prompt execution (useful for shared instructions)
- `claude_binary` — path to claude CLI binary (default: `claude`)

---

### 2. Manual Mode — Prompt Queue

Manual mode lets you create individual prompts, arrange them in a queue, and execute them sequentially.

#### Create Prompts

```bash
# Create a prompt (auto-appended to queue)
curl -X POST http://localhost:51793/api/prompts \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "Add login API",
    "content": "Implement POST /api/auth/login with JWT token response.",
    "working_directory": "/path/to/project"
  }'

# working_directory is optional (falls back to global setting)
curl -X POST http://localhost:51793/api/prompts \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "Add unit tests for login",
    "content": "Write vitest unit tests for the login API endpoint."
  }'
```

#### List / Update / Delete Prompts

```bash
# List all prompts (ordered by queue_order)
curl http://localhost:51793/api/prompts

# Update a prompt
curl -X PUT http://localhost:51793/api/prompts/{id} \
  -H 'Content-Type: application/json' \
  -d '{ "title": "Updated title", "content": "Updated content" }'

# Delete a prompt (remaining prompts auto-reorder)
curl -X DELETE http://localhost:51793/api/prompts/{id}
```

#### Reorder Queue

```bash
# Pass ordered prompt IDs to set execution order
curl -X PUT http://localhost:51793/api/prompts/reorder \
  -H 'Content-Type: application/json' \
  -d '{ "orderedIds": ["prompt-id-3", "prompt-id-1", "prompt-id-2"] }'
```

#### Execute the Queue

```bash
# Start execution (runs all pending prompts sequentially)
curl -X POST http://localhost:51793/api/run

# Start from a specific prompt
curl -X POST http://localhost:51793/api/run \
  -H 'Content-Type: application/json' \
  -d '{ "startFromPromptId": "prompt-id-2" }'

# Check status
curl http://localhost:51793/api/run/status

# Pause / Resume / Stop
curl -X PATCH http://localhost:51793/api/run \
  -H 'Content-Type: application/json' \
  -d '{ "action": "pause" }'

curl -X PATCH http://localhost:51793/api/run \
  -H 'Content-Type: application/json' \
  -d '{ "action": "resume" }'

curl -X DELETE http://localhost:51793/api/run
```

#### Monitor via SSE

```bash
# Stream real-time output (Server-Sent Events)
curl -N http://localhost:51793/api/run/stream
```

Events: `text_delta`, `tool_start`, `tool_end`, `prompt_start`, `prompt_complete`, `prompt_failed`, `rate_limit`, `queue_complete`, `queue_stopped`

---

### 3. Plans — Group Prompts into Execution Plans

Plans let you bundle selected prompts with a plan-level context prompt. During plan execution, each prompt receives: `global_prompt + plan_prompt + prompt_content`.

#### Create a Plan

```bash
curl -X POST http://localhost:51793/api/plans \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "Auth Feature Sprint",
    "description": "Implement full authentication flow",
    "plan_prompt": "You are working on the auth module. All code goes in src/auth/."
  }'
```

#### Add Prompts to a Plan

```bash
# Add existing prompts to the plan (one at a time)
curl -X POST http://localhost:51793/api/plans/{planId}/items \
  -H 'Content-Type: application/json' \
  -d '{ "prompt_id": "prompt-id-1" }'

curl -X POST http://localhost:51793/api/plans/{planId}/items \
  -H 'Content-Type: application/json' \
  -d '{ "prompt_id": "prompt-id-2" }'
```

#### Reorder Plan Items

```bash
curl -X PUT http://localhost:51793/api/plans/{planId}/items/reorder \
  -H 'Content-Type: application/json' \
  -d '{ "orderedIds": ["item-id-2", "item-id-1"] }'
```

#### Remove Item from Plan

```bash
curl -X DELETE http://localhost:51793/api/plans/{planId}/items/{itemId}
```

#### View Plan Details

```bash
# List all plans
curl http://localhost:51793/api/plans

# Get plan with its items
curl http://localhost:51793/api/plans/{planId}
```

#### Execute a Plan

```bash
# Start plan execution
curl -X POST http://localhost:51793/api/run \
  -H 'Content-Type: application/json' \
  -d '{ "planId": "plan-id" }'

# Start from a specific plan item
curl -X POST http://localhost:51793/api/run \
  -H 'Content-Type: application/json' \
  -d '{ "planId": "plan-id", "startFromPlanItemId": "item-id-3" }'
```

---

### 4. Auto Mode — Autonomous Agent Pipeline

Auto mode runs an autonomous multi-agent pipeline in cycles against a target project. The default pipeline is:

**UX Planner + Tech Planner + Biz Planner** (parallel) → **Planning Moderator** → **Developer** → **Reviewer** → **QA Engineer**

- **Pipeline Types**: discovery (full) | fix (Dev→Review→QA) | test_fix (TestEng→QA)
- **Parallel Worker Pool** — N independent workers process findings simultaneously using git worktrees

Each cycle picks the highest-priority finding, runs the pipeline, and commits on success. A **watchdog** agent checks every hour to kill stuck cycles.

#### Configure Auto Settings

```bash
curl -X PUT http://localhost:51793/api/auto/settings \
  -H 'Content-Type: application/json' \
  -d '{
    "target_project": "/path/to/target/project",
    "test_command": "npm test",
    "max_cycles": 10,
    "budget_usd": 5.0,
    "auto_commit": true,
    "branch_name": "auto/improvements"
  }'
```

#### Start / Stop / Pause Autonomous Session

```bash
# Start with optional initial prompt
curl -X POST http://localhost:51793/api/auto \
  -H 'Content-Type: application/json' \
  -d '{
    "targetProject": "/path/to/project",
    "initialPrompt": "Focus on improving test coverage for the auth module."
  }'

# Check status
curl http://localhost:51793/api/auto/status

# Pause immediately
curl -X PATCH http://localhost:51793/api/auto \
  -H 'Content-Type: application/json' \
  -d '{ "action": "pause" }'

# Pause after current cycle completes (graceful)
curl -X PATCH http://localhost:51793/api/auto \
  -H 'Content-Type: application/json' \
  -d '{ "action": "pause_after_cycle" }'

# Resume
curl -X PATCH http://localhost:51793/api/auto \
  -H 'Content-Type: application/json' \
  -d '{ "action": "resume" }'

# Stop
curl -X DELETE http://localhost:51793/api/auto
```

#### Inject Mid-Session Prompts

Add instructions while autonomous mode is running. These are included in subsequent cycles.

```bash
# Add a mid-session prompt (active for next 3 cycles)
curl -X POST http://localhost:51793/api/auto/prompts \
  -H 'Content-Type: application/json' \
  -d '{
    "content": "Prioritize fixing the failing login test.",
    "activeForCycles": 3
  }'

# List mid-session prompts
curl http://localhost:51793/api/auto/prompts

# Remove a mid-session prompt
curl -X DELETE http://localhost:51793/api/auto/prompts/{id}
```

#### CEO Escalation (Agent → Human Requests)

Agents can create escalation requests when they need human decisions.

```bash
# List pending CEO requests
curl "http://localhost:51793/api/auto/findings?status=pending"

# Respond to a CEO request
curl -X PATCH http://localhost:51793/api/auto/ceo-requests/{id} \
  -H 'Content-Type: application/json' \
  -d '{ "response": "Approved. Proceed with the proposed approach." }'
```

#### Monitor Auto Mode via SSE

```bash
curl -N http://localhost:51793/api/auto/stream
```

#### View Auto Mode History

```bash
# List sessions
curl http://localhost:51793/api/auto/sessions

# Get cycles for a session
curl "http://localhost:51793/api/auto/cycles?sessionId={sessionId}"

# Get agent runs for a cycle
curl "http://localhost:51793/api/auto/agent-runs?cycleId={cycleId}"

# Query findings
curl "http://localhost:51793/api/auto/findings?status=open&priority=high"
```

#### Manage Agents

```bash
# List all agents
curl http://localhost:51793/api/auto/agents

# Create custom agent
curl -X POST http://localhost:51793/api/auto/agents \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "security-scanner",
    "display_name": "Security Scanner",
    "system_prompt": "You are a security auditor. Find vulnerabilities.",
    "role_description": "Scans for security issues",
    "model": "claude-sonnet-4-6"
  }'

# Toggle agent on/off
curl -X PATCH http://localhost:51793/api/auto/agents/{id}/toggle

# Delete custom agent (built-in agents cannot be deleted)
curl -X DELETE http://localhost:51793/api/auto/agents/{id}
```

---

### 5. Execution History

```bash
# List executions (paginated)
curl "http://localhost:51793/api/history?limit=20&offset=0"

# Get single execution detail (includes full output)
curl http://localhost:51793/api/history/{executionId}
```

Each execution record contains: `status`, `output`, `cost_usd`, `duration_ms`, `effective_prompt`, `started_at`, `completed_at`.

---

### Quick Reference — Common Workflows

#### Workflow A: Run a batch of tasks sequentially

```bash
# 1. Create prompts
curl -X POST .../api/prompts -d '{"title":"Task 1","content":"..."}'
curl -X POST .../api/prompts -d '{"title":"Task 2","content":"..."}'
curl -X POST .../api/prompts -d '{"title":"Task 3","content":"..."}'

# 2. Execute
curl -X POST .../api/run

# 3. Monitor
curl -N .../api/run/stream
```

#### Workflow B: Execute a plan with shared context

```bash
# 1. Create prompts
# 2. Create a plan with plan_prompt
curl -X POST .../api/plans -d '{"name":"Sprint","plan_prompt":"Shared context..."}'

# 3. Add prompts to plan
curl -X POST .../api/plans/{id}/items -d '{"prompt_id":"..."}'

# 4. Execute the plan
curl -X POST .../api/run -d '{"planId":"..."}'
```

#### Workflow C: Autonomous improvement

```bash
# 1. Configure
curl -X PUT .../api/auto/settings -d '{"target_project":"/path","test_command":"npm test"}'

# 2. Start
curl -X POST .../api/auto -d '{"initialPrompt":"Improve test coverage"}'

# 3. Inject guidance mid-session if needed
curl -X POST .../api/auto/prompts -d '{"content":"Focus on auth module"}'

# 4. Gracefully stop after current cycle
curl -X PATCH .../api/auto -d '{"action":"pause_after_cycle"}'
```

## License

Apache 2.0
