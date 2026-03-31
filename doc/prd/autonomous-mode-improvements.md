# Autonomous Mode Improvements -- Product Requirements Document

- **Date**: 2026-03-21
- **Author**: Engineering Team
- **Status**: Implemented
- **Version**: v7 (Pipeline Branching + Efficiency Overhaul)

---

## 1. Background and Problem Statement

mlaude's autonomous mode operates a continuous improvement loop: it discovers issues in a target project, plans fixes, implements them, reviews the changes, and runs QA -- all without human intervention. Each iteration of this loop is called a **cycle**, and a cycle executes a **pipeline** of specialized AI agents.

Before this release, the autonomous mode suffered from several efficiency and correctness problems:

1. **Uniform pipeline overhead**: Every cycle ran the full 7-agent pipeline (3 Planners, Moderator, Developer, Reviewer, QA) regardless of whether the task was a new feature discovery, a simple bug fix, or a test correction. Bug fix cycles wasted ~8 minutes on planning agents that added no value. Test fix cycles wasted ~20 minutes running a Developer and Reviewer when only test code needed updating.

2. **CEO escalation noise**: Agents escalated routine code decisions to the CEO (human operator), creating a backlog of 7+ pending requests that were all solvable by the agents themselves. This blocked cycles and wasted human attention.

3. **Duplicate test_failure findings**: When QA failed, a new finding was created every cycle. After 8 consecutive failures on the same test, 8 identical findings accumulated, polluting the backlog and causing redundant fix attempts.

4. **Slow QA on fix cycles**: The QA agent launched mobile-mcp UI testing (screenshots, tap sequences, visual verification) for every cycle, even trivial bug fixes. This added 15+ minutes per cycle for no additional verification value on non-UI changes.

5. **Web-only codebase scanner**: The rule-based scanner only recognized Next.js/React project structures. Flutter, Rust, Go, Python, and other project types produced empty or misleading summaries.

6. **No persistent global instructions**: Operators had no way to inject standing instructions into all agents across all cycles for autonomous mode sessions.

7. **Poor markdown rendering**: The custom markdown renderer failed on newlines, had no syntax highlighting, and broke GFM tables.

8. **Modal sizing inconsistency**: All 14 dialogs used a single default size, causing small confirmation dialogs to appear oversized and complex detail dialogs to feel cramped.

---

## 2. Goals

| Goal | Metric |
|------|--------|
| Reduce fix cycle time | From ~30 min to ~22 min (skip planning phase) |
| Reduce test_fix cycle time | From ~30 min to ~10 min (Test Engineer + QA only) |
| Reduce QA time for fix/test_fix cycles | From ~17 min to ~2 min (code-based tests only) |
| Eliminate unnecessary CEO escalations | 0 escalations for code-change decisions |
| Prevent duplicate test_failure findings | Max 1 open test_failure finding at a time |
| Support any project type in codebase scanner | Flutter, Rust, Go, Python, etc. |
| Provide global prompt injection for auto mode | Configurable via settings UI |
| Improve markdown rendering fidelity | Proper newlines, code highlighting, GFM tables |

### Non-Goals

- Changing the discovery pipeline structure (Planner x3 -> Moderator -> Developer -> Reviewer -> QA remains as-is for discovery)
- Adding new agent roles beyond Test Engineer
- Modifying the manual (non-autonomous) mode

---

## 3. Features

### 3.1 Pipeline Branching

**Problem**: Every cycle executed the full 7-agent pipeline, regardless of context.

**Solution**: Three pipeline types selected automatically based on the cycle's finding category.

| Pipeline Type | Trigger | Agents | Expected Duration |
|---------------|---------|--------|-------------------|
| `discovery` | No finding (new exploration) | UX Planner, Tech Planner, Biz Planner (parallel) -> Planning Moderator -> Developer -> Reviewer -> QA | ~30 min |
| `fix` | Finding with category != `test_failure` | Developer -> Reviewer -> QA | ~22 min |
| `test_fix` | Finding with category == `test_failure` | Test Engineer -> QA | ~10 min |

**Pipeline type selection** (`cycle-engine.ts`):

```
determinePipelineType(finding):
  if no finding  -> 'discovery'
  if finding.category == 'test_failure' -> 'test_fix'
  else -> 'fix'
```

**Agent filtering** (`pipeline-executor.ts`, `filterAgentsByPipelineType`):

```
discovery: all agents except test_engineer
fix:       developer, reviewer, qa_engineer
test_fix:  test_engineer, qa_engineer
```

**New Agent -- Test Engineer** (`seed-agents.ts`, `builtin-test_engineer`):

- Specialized in Flutter/Dart test code (flutter_test, integration_test, WidgetTester API)
- Modifies test code to fix failures; prefers test code changes over production code changes
- Reports BLOCKER only when the failure indicates a genuine production code bug
- Pipeline order: 1.0 (same slot as Developer, mutually exclusive by pipeline type)

### 3.2 CEO Escalation Reform

**Problem**: Agents escalated routine code decisions ("Should I modify this test file?", "Can I change the widget layout?"), creating a queue of 7 pending requests that were all agent-solvable.

**Solution**: Rewrote the CEO escalation prompt (`CEO_ESCALATION_PROMPT` in `seed-agents.ts`) to restrict escalation to physically impossible tasks only.

**Escalation criteria (new)**:

| Allowed (must escalate) | Not Allowed (handle autonomously) |
|------------------------|-----------------------------------|
| External service access (API keys, subscriptions, third-party accounts) | All code changes (production, test, config) |
| Infrastructure/deployment (servers, DNS, cloud, CI/CD, app store submissions) | Refactoring decisions |
| Budget/cost decisions | Test strategy changes |
| Communication with external teams | File structure changes |
| Hardware/physical equipment | Dependency updates |

**Key instruction**: "Even if you lack confidence in your code, do not escalate. Implement using your best judgment and verify with tests."

The 7 previously pending CEO requests were dismissed as all were agent-solvable code decisions.

### 3.3 QA Test_failure Finding Deduplication

**Problem**: Each QA failure created a new `test_failure` finding. After 8 consecutive failures on the same issue, the findings list contained 8 near-identical entries.

**Solution** (`cycle-engine.ts`, lines 716-735):

```
On QA failure:
  1. Query existing open findings where category='test_failure' AND title='QA tests failed in pipeline cycle'
  2. If found: update description with latest test output
  3. If not found: create new finding
```

This ensures at most one open `test_failure` finding exists at a time. The description is kept current with the latest failure output so the next fix attempt has up-to-date context.

### 3.4 QA Fast Verification Mode

**Problem**: The QA agent used mobile-mcp (screenshots, taps, swipes) for all cycles, adding ~17 minutes even for trivial bug fixes.

**Solution** (`agent-context-builder.ts`, lines 141-151):

For `fix` and `test_fix` pipeline types, the QA agent receives a `[QA Mode: Fast Verification]` context override that:

1. Disables mobile-mcp UI testing (no screenshots, taps, swipes)
2. Runs only code-based test commands (`flutter test`, `npm test`, etc.)
3. Verifies build success
4. Reports results in standard JSON format

Discovery pipelines retain full mobile-mcp E2E testing with screenshot capture and visual verification.

**Expected QA time reduction**: 17 min -> 1-2 min per fix/test_fix cycle.

### 3.5 Discord CEO Notifications

**Problem**: CEO requests were only visible in the mlaude web UI. The human operator had to actively check the dashboard.

**Solution**: Discord bot integration for CEO request notifications and responses.

**Implementation** (`src/discord/`):

| Component | File | Purpose |
|-----------|------|---------|
| Notification handler | `notifications.ts` | Listens to auto mode SSE stream, sends embeds for `ceo_request_created` events |
| Embed builder | `embeds.ts` | Builds Discord rich embeds with request details (title, description, type, blocking status, requesting agent) |
| Thread management | `notifications.ts` | Auto-creates a Discord thread for each CEO request |
| Reply parser | `bot.ts` (`parseCEOStatus`) | Parses thread replies as approved/rejected/answered |
| API integration | `bot.ts` (`setupCEOReplyHandler`) | Forwards parsed responses to mlaude API |

**Reply parsing** (bilingual Korean/English):

| First line of reply | Status |
|--------------------|--------|
| "approve" / "approved" | `approved` |
| "reject" / "rejected" | `rejected` |
| Any other text | `answered` |

Only the first reply in each thread is processed. Only the configured Discord owner (`DISCORD_OWNER_ID`) can respond.

### 3.6 Global Prompt for Auto Mode

**Problem**: No mechanism to inject persistent instructions into all agents for autonomous mode sessions. The existing settings prompt was for manual mode only.

**Solution**: Added `global_prompt` field to `AutoSettings` (stored in `auto_settings` table).

**Data flow**:

```
Settings UI (/auto/settings) -> PUT /api/auto/settings { global_prompt: "..." }
                                         |
                                         v
                               auto_settings table
                                         |
                                         v
              PipelineExecutor reads settings.global_prompt
                                         |
                                         v
              buildAgentContext() injects as [Global Instructions]
              (placed after system prompt, before user prompt)
```

The `global_prompt` appears in the agent context as:

```
[Agent System Prompt]

[Global Instructions]
{global_prompt content}

[CEO Responses / User Prompt / Session State / ...]
```

### 3.7 LLM-based Codebase Scanner

**Problem**: The rule-based codebase scanner (`CodebaseScanner`) only recognized web project structures (Next.js, Vite, etc.). Flutter, Rust, Go, Python projects received empty or misleading summaries.

**Solution** (`codebase-scanner.ts`): Two-phase architecture.

**Phase 1: Rule-based context gathering** (unchanged):

- Lists root files and config files from a predefined set of 35+ filenames (`package.json`, `pubspec.yaml`, `Cargo.toml`, `go.mod`, `pyproject.toml`, etc.)
- Lists source directories (`lib/`, `src/`, `app/`, `cmd/`, `pkg/`, `internal/`, `test/`, `tests/`)
- Reads first 100 lines of `README.md` and `CLAUDE.md`
- Reads config file contents (up to 5000 chars each)

**Phase 2: LLM summary generation** (new):

- Sends gathered context to Claude haiku model via one-shot CLI call
- Prompt: "Analyze this project and produce a concise markdown summary (under 50 lines)"
- 60-second timeout
- Falls back to file listing on failure

**Caching**: Result is cached in `CycleEngineImpl.codebaseSummaryCache` for the duration of the session. Runs once at session start.

### 3.8 Planning Moderator PRD Output

**Problem**: The Planning Moderator's output was only available as JSON in the agent run record, not as a readable document.

**Solution**: Added instruction to the Planning Moderator's system prompt to write a formal planning document to `docs/PRD.md` in the target project.

**Behavior**:

- If `docs/PRD.md` does not exist: creates the file with the cycle's planning document
- If `docs/PRD.md` exists: appends the new cycle's planning content with a date header
- Format includes: title, background/purpose, agreed items with detailed descriptions, deferred items, conflict resolution notes
- The JSON pipeline output is unchanged (the agent outputs both the file and the JSON)

### 3.9 Markdown Renderer Upgrade

**Problem**: The custom `MarkdownOutput` component had broken newline handling, no code syntax highlighting, and malformed GFM table rendering.

**Solution** (`src/components/auto/MarkdownOutput.tsx`): Replaced the custom implementation with a stack of established libraries.

| Library | Purpose |
|---------|---------|
| `react-markdown` | Core markdown-to-React renderer |
| `remark-gfm` | GitHub Flavored Markdown plugin (tables, strikethrough, task lists) |
| `react-syntax-highlighter` (Prism, oneDark theme) | Fenced code block syntax highlighting |

Custom component overrides for: headings (h1-h3), paragraphs, lists (ul/ol/li), tables (table/th/td), inline code, blockquotes, links, horizontal rules. All styled with Tailwind CSS classes matching the dark theme.

### 3.10 UI Improvements

**Modal size system** (`src/components/ui/Modal.tsx`):

| Size | Max Width | Use Case |
|------|-----------|----------|
| `sm` | `max-w-sm` | Confirmations, simple alerts |
| `md` | `max-w-lg` | Standard forms (default) |
| `lg` | `max-w-2xl` | Detail views, medium forms |
| `xl` | `max-w-4xl` | Complex content, side-by-side layouts |
| `2xl` | `max-w-6xl` | Full output views, code reviews |

Applied to all 14 dialogs across the application.

**Findings page persistent filters** (`src/app/auto/findings/page.tsx`):

- Filter options: status (6 values), priority (P0-P3), category (7 types)
- Sort options: priority, status, category, title, retries, created date (ascending/descending)
- Preferences persisted to `localStorage` under key `mlaude_findings_prefs`
- Restored on page load; survives browser refresh and navigation

---

## 4. Technical Design

### 4.1 Pipeline Type System

The `PipelineType` union type (`types.ts`):

```typescript
export type PipelineType = 'discovery' | 'fix' | 'test_fix';
```

Flow through the system:

```
CycleEngineImpl._processNextCyclePipeline()
  -> determinePipelineType(finding)     // Returns PipelineType
  -> new PipelineExecutor(..., pipelineType)
     -> filterAgentsByPipelineType()    // Filters enabled agents
     -> buildAgentContext(..., pipelineType)  // Injects QA mode override
```

### 4.2 Agent Architecture

Eight built-in agents defined in `seed-agents.ts`, seven active by default:

```
Pipeline Order:
  0.1  UX Planner      (parallel_group: 'planning')
  0.2  Tech Planner     (parallel_group: 'planning')
  0.3  Biz Planner      (parallel_group: 'planning')
  0.5  Planning Moderator
  1.0  Developer         (exclusive with Test Engineer by pipeline type)
  1.0  Test Engineer     (exclusive with Developer by pipeline type)
  2.0  Reviewer
  3.0  QA Engineer
```

Product Designer (pipeline_order: 0.0) is disabled by default, superseded by the Planner + Moderator pipeline.

### 4.3 Discord Integration Architecture

```
mlaude server (Next.js)
  |
  |  SSE stream (/api/auto/stream)
  v
Discord bot (src/discord/bot.ts)
  |
  |-- notifications.ts: Listens to SSE, sends embeds
  |-- embeds.ts: Builds Discord embed objects
  |-- bot.ts: Handles thread replies for CEO requests
  |
  v
Discord API
  |
  |-- Channel messages with rich embeds
  |-- Auto-created threads per CEO request
  |-- Thread reply -> parseCEOStatus() -> API call to /api/auto/report/requests/[id]
```

### 4.4 Database Changes

New setting in `auto_settings` table:

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `global_prompt` | TEXT | `''` | Injected into all agent contexts after system prompt |

No schema migrations required. The `auto_settings` table uses a key-value pattern; new keys are added by the settings API route.

---

## 5. Success Criteria

| Criterion | Measurement | Target |
|-----------|-------------|--------|
| Fix pipeline skips planning agents | Agent runs per fix cycle | 3 (Developer, Reviewer, QA) |
| Test_fix pipeline runs minimal agents | Agent runs per test_fix cycle | 2 (Test Engineer, QA) |
| QA fast mode skips mobile-mcp | No mobile-mcp tool calls in fix/test_fix QA runs | 0 mobile-mcp invocations |
| No duplicate test_failure findings | Count of open test_failure findings with identical titles | <= 1 |
| CEO escalation reduction | CEO requests per session for code decisions | 0 |
| Codebase scanner works for Flutter | Non-empty summary for pubspec.yaml projects | Non-empty markdown output |
| Discord CEO notification delivery | CEO request appears in Discord within 10s | < 10s latency |
| Discord thread reply processed | Reply in thread updates CEO request status | Status updated in DB |
| Global prompt injected | Agent context contains [Global Instructions] | Present in all agent runs |

---

## 6. Open Questions and Future Work

| Item | Status | Notes |
|------|--------|-------|
| Test Engineer for non-Flutter projects | Future | Current system prompt is Flutter/Dart specific. Need variants for Jest, pytest, Go test, etc. |
| Pipeline type for `improvement` category | Decided | Uses `fix` pipeline. Could warrant a separate `improve` pipeline in the future. |
| Automatic CEO request dismissal | Future | Auto-dismiss requests older than N cycles if the finding was resolved without CEO input. |
| QA fast mode for discovery with no UI changes | Future | Discovery cycles with code-only changes could also use fast QA mode. |
| Discord thread auto-archive timing | Current: 24h | May need adjustment based on CEO response latency. |
| Codebase scanner cache invalidation | Current: per-session | Consider invalidating on significant file changes within a session. |
| Planning Moderator PRD file path | Current: `docs/PRD.md` | May conflict with existing project documentation. Consider a configurable path. |
