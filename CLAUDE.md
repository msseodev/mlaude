# mlaude - Claude Code Automation Tool

## Project Overview

A Claude Code automation tool that queues multiple prompts for sequential execution with automatic rate limit handling and retry with exponential backoff.

## Tech Stack

- **Frontend**: Next.js 16 (App Router), React 19, Tailwind CSS 4
- **Backend**: Next.js API Routes
- **DB**: better-sqlite3 (SQLite)
- **Unit Test**: Vitest (`tests/unit/`)
- **E2E Test**: Playwright (`tests/e2e/`)
- **Language**: TypeScript

## Project Structure

```
src/
├── app/
│   ├── api/           # API Routes (prompts, plans, run, history, settings, auto)
│   ├── auto/          # Autonomous mode pages (dashboard, findings, agents, cycles)
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
│   │   ├── git-manager.ts          # Git checkpoint/rollback
│   │   ├── state-manager.ts        # SESSION-STATE.md management
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

## Commands

```bash
npm run dev          # Dev server (http://localhost:51793)
npm run build        # Production build
npm run lint         # ESLint
npm test             # Unit tests (vitest run)
npm run test:watch   # Unit tests in watch mode
npm run test:e2e     # E2E tests (playwright)
```

## Core Workflow Principles

All development follows the agent orchestration pattern described below.

### 1. TDD (Test-Driven Development)

All feature development follows the TDD cycle:
1. **Red** — Write a failing test first
2. **Green** — Write the minimum code to make the test pass
3. **Refactor** — Refactor while keeping tests green

### 2. Agent Orchestration

Delegate tasks to specialized agents as follows:

#### coder agent (`subagent_type: "coder"`)
- Handles all coding tasks (feature implementation, bug fixes, writing tests)
- Follows the TDD cycle: write tests first, then implement
- Applies reviewer feedback
- Fixes E2E test failures

#### reviewer agent (`subagent_type: "reviewer"`)
- Reviews code written by the coder
- Provides feedback on code quality, performance, security, and architecture
- Feedback is relayed to the coder for resolution

#### E2E tester agent (`subagent_type: "web-e2e-tester"`)
- Runs E2E tests after feature implementation is complete
- On test failure, reports details to the coder for fixes

### 3. Development Flow

```
1. coder: Write a failing test (Red)
2. coder: Implement code to pass the test (Green)
3. coder: Refactor (Refactor)
4. reviewer: Code review
5. coder: Apply review feedback
6. web-e2e-tester: Run E2E tests
7. (On failure) coder: Fix E2E failures → Go back to step 6
```

## Coding Conventions

- Follow existing code style
- Path alias: `@/` → `src/`
- API Routes follow the App Router pattern
- Components are written as functional components
- State management uses React hooks
