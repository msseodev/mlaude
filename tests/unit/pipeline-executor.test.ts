import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { parseReviewOutput, parseQAOutput, parseDeveloperOutput, filterAgentsByPipelineType, extractSmokeScreenshots, extractSmokeFailures } from '../../src/lib/autonomous/pipeline-executor';
import type { AutoAgent, AutoAgentRun } from '../../src/lib/autonomous/types';

// Mock dependencies for PipelineExecutor.execute() tests
vi.mock('../../src/lib/autonomous/db', () => ({
  getAutoAgents: vi.fn(),
  createAutoAgentRun: vi.fn(),
  updateAutoAgentRun: vi.fn(),
  getAllAutoSettings: vi.fn(),
  getAutoUserPrompts: vi.fn(),
  getAutoCycle: vi.fn(),
  getCEORequests: vi.fn(() => []),
  createCEORequest: vi.fn(),
}));

vi.mock('../../src/lib/db', () => ({
  getSetting: vi.fn(() => 'claude'),
}));

vi.mock('../../src/lib/autonomous/state-manager', () => ({
  StateManager: class {
    readState() { return Promise.resolve(''); }
  },
}));

vi.mock('../../src/lib/autonomous/user-prompt-builder', () => ({
  buildUserPrompt: vi.fn(() => 'test prompt'),
}));

vi.mock('../../src/lib/autonomous/agent-context-builder', () => ({
  buildAgentContext: vi.fn(() => 'mocked context'),
}));

vi.mock('../../src/lib/autonomous/output-parser', () => ({
  parseAgentOutput: vi.fn(() => ({ summary: 'test summary', structuredData: null })),
  parseCEORequests: vi.fn(() => []),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;

// ClaudeExecutor mock: overridden per test via mockClaudeExecutorImpl
let mockClaudeExecutorImpl: (binary: string, onEvent: AnyFn, onRateLimit: AnyFn, onComplete: AnyFn) => { execute: AnyFn; kill: AnyFn };

vi.mock('../../src/lib/claude-executor', () => ({
  ClaudeExecutor: class {
    private _impl: { execute: AnyFn; kill: AnyFn };
    constructor(binary: string, onEvent: AnyFn, onRateLimit: AnyFn, onComplete: AnyFn) {
      this._impl = mockClaudeExecutorImpl(binary, onEvent, onRateLimit, onComplete);
    }
    execute(...args: unknown[]) { return this._impl.execute(...args); }
    kill(...args: unknown[]) { return this._impl.kill(...args); }
  },
}));

describe('parseReviewOutput', () => {
  it('parses approved review', () => {
    const output = '{"approved": true, "issues": [], "summary": "LGTM"}';
    const result = parseReviewOutput(output);
    expect(result.approved).toBe(true);
  });

  it('parses rejected review with issues', () => {
    const output = JSON.stringify({
      approved: false,
      issues: [
        { severity: 'critical', file: 'src/index.ts', description: 'Missing error handling', suggestion: 'Add try-catch' }
      ],
      summary: 'Needs fixes',
    });
    const result = parseReviewOutput(output);
    expect(result.approved).toBe(false);
    expect(result.feedback).toContain('Missing error handling');
  });

  it('extracts JSON from mixed output', () => {
    const output = 'Here is my review:\n\n```json\n{"approved": false, "issues": [{"severity": "major", "description": "Bug found"}], "summary": "Fix needed"}\n```\n\nPlease fix these issues.';
    const result = parseReviewOutput(output);
    expect(result.approved).toBe(false);
    expect(result.feedback).toContain('Bug found');
  });

  it('defaults to approved on malformed output', () => {
    const result = parseReviewOutput('This is not JSON at all');
    expect(result.approved).toBe(true);
    expect(result.feedback).toBe('');
  });

  it('defaults to approved on empty output', () => {
    const result = parseReviewOutput('');
    expect(result.approved).toBe(true);
  });

  it('uses summary as feedback when no issues array', () => {
    const output = '{"approved": false, "summary": "Multiple problems found"}';
    const result = parseReviewOutput(output);
    expect(result.approved).toBe(false);
    expect(result.feedback).toBe('Multiple problems found');
  });

  it('correctly parses approved=false when team_messages JSON follows the review JSON', () => {
    // This reproduces the real-world bug where greedy regex matched across
    // both the review JSON and the team_messages JSON, causing JSON.parse to fail
    // and defaulting to approved=true
    const output = `Now let me read the full contents. All 6 review agents have completed.

\`\`\`json
{
  "approved": false,
  "issues": [
    {
      "severity": "critical",
      "perspective": "correctness",
      "file": "lib/providers/playback_provider.dart",
      "lines": "326-329",
      "description": "Count-in duration wrong for compound meters"
    },
    {
      "severity": "major",
      "perspective": "architecture",
      "file": "lib/widgets/overlays.dart",
      "lines": "217-220",
      "description": "WidgetRef passed as constructor field"
    }
  ],
  "summary": "1 critical, 1 major. Not approved."
}
\`\`\`

\`\`\`json
{
  "team_messages": [
    {
      "category": "convention",
      "content": "Never pass WidgetRef as a constructor field."
    }
  ]
}
\`\`\``;

    const result = parseReviewOutput(output);
    expect(result.approved).toBe(false);
    expect(result.feedback).toContain('Count-in duration wrong');
    expect(result.feedback).toContain('WidgetRef passed');
  });

  it('correctly parses approved=false with inline JSON (no code blocks) followed by team_messages', () => {
    const output = `Review complete.
{"approved": false, "issues": [{"severity": "critical", "description": "Bug"}], "summary": "Fix it"}
{"team_messages": [{"category": "pattern", "content": "note"}]}`;

    const result = parseReviewOutput(output);
    expect(result.approved).toBe(false);
    expect(result.feedback).toContain('Bug');
  });

  it('correctly parses approved=true with trailing team_messages', () => {
    const output = `All good.
\`\`\`json
{"approved": true, "issues": [], "summary": "LGTM"}
\`\`\`
\`\`\`json
{"team_messages": [{"category": "convention", "content": "good patterns"}]}
\`\`\``;

    const result = parseReviewOutput(output);
    expect(result.approved).toBe(true);
  });
});

describe('parseQAOutput', () => {
  it('parses passing test results', () => {
    const output = JSON.stringify({
      summary: { total: 10, passed: 10, failed: 0, skipped: 0 },
      failures: [],
    });
    const result = parseQAOutput(output);
    expect(result.passed).toBe(true);
  });

  it('parses failing test results', () => {
    const output = JSON.stringify({
      summary: { total: 10, passed: 8, failed: 2, skipped: 0 },
      failures: [{ test_name: 'login test', error_message: 'assertion failed' }],
    });
    const result = parseQAOutput(output);
    expect(result.passed).toBe(false);
    expect(result.testOutput).toContain('login test');
  });

  it('extracts JSON from mixed output', () => {
    const output = 'Running tests...\n\n{"summary": {"total": 5, "passed": 5, "failed": 0}}\n\nDone.';
    const result = parseQAOutput(output);
    expect(result.passed).toBe(true);
  });

  it('defaults to passed on malformed output', () => {
    const result = parseQAOutput('All tests passed!');
    expect(result.passed).toBe(true);
  });

  it('defaults to passed on empty output', () => {
    const result = parseQAOutput('');
    expect(result.passed).toBe(true);
  });

  it('uses new_failed instead of failed when new_failed is present', () => {
    const output = JSON.stringify({
      summary: { total: 10, passed: 7, failed: 3, new_failed: 0, skipped: 0 },
      failures: [],
    });
    const result = parseQAOutput(output);
    expect(result.passed).toBe(true);
  });

  it('fails when new_failed > 0 even if failed includes pre-existing failures', () => {
    const output = JSON.stringify({
      summary: { total: 10, passed: 7, failed: 3, new_failed: 1, skipped: 0 },
      failures: [{ test_name: 'new regression', error_message: 'assertion failed' }],
    });
    const result = parseQAOutput(output);
    expect(result.passed).toBe(false);
  });

  it('falls back to failed when new_failed is not present', () => {
    const output = JSON.stringify({
      summary: { total: 10, passed: 8, failed: 2, skipped: 0 },
      failures: [],
    });
    const result = parseQAOutput(output);
    expect(result.passed).toBe(false);
  });

  it('uses new_failed from mixed output with surrounding text', () => {
    const output = 'Test results:\n\n{"summary": {"total": 5, "passed": 3, "failed": 2, "new_failed": 0}}\n\nAll new changes verified.';
    const result = parseQAOutput(output);
    expect(result.passed).toBe(true);
  });
});

describe('parseDeveloperOutput', () => {
  it('detects BLOCKER: pattern', () => {
    const output = 'I tried to implement the feature but:\n\nBLOCKER: The spec requires a database schema that conflicts with existing tables';
    const result = parseDeveloperOutput(output);
    expect(result.blocked).toBe(true);
    expect(result.blockerReason).toBe('The spec requires a database schema that conflicts with existing tables');
  });

  it('detects BLOCKED: pattern', () => {
    const output = 'BLOCKED: Missing API endpoint definition in the spec';
    const result = parseDeveloperOutput(output);
    expect(result.blocked).toBe(true);
    expect(result.blockerReason).toBe('Missing API endpoint definition in the spec');
  });

  it('detects CANNOT IMPLEMENT: pattern', () => {
    const output = 'CANNOT IMPLEMENT: The required dependency is incompatible with the current Node version';
    const result = parseDeveloperOutput(output);
    expect(result.blocked).toBe(true);
    expect(result.blockerReason).toBe('The required dependency is incompatible with the current Node version');
  });

  it('detects JSON structured blocker', () => {
    const output = 'Here is my status:\n\n{"blocked": true, "reason": "No authentication module available"}';
    const result = parseDeveloperOutput(output);
    expect(result.blocked).toBe(true);
    expect(result.blockerReason).toBe('No authentication module available');
  });

  it('returns blocked false for normal developer output', () => {
    const output = 'I implemented the feature successfully. All files have been updated and tests pass.';
    const result = parseDeveloperOutput(output);
    expect(result.blocked).toBe(false);
    expect(result.blockerReason).toBe('');
  });

  it('does not trigger on lowercase "blocker" in a sentence', () => {
    const output = 'There was no blocker during implementation. Everything went smoothly and the feature is complete.';
    const result = parseDeveloperOutput(output);
    expect(result.blocked).toBe(false);
    expect(result.blockerReason).toBe('');
  });

  it('detects IMPLEMENTATION FAILED: pattern', () => {
    const output = 'IMPLEMENTATION FAILED: Build errors in TypeScript compilation';
    const result = parseDeveloperOutput(output);
    expect(result.blocked).toBe(true);
    expect(result.blockerReason).toBe('Build errors in TypeScript compilation');
  });

  it('detects SPEC ISSUE: pattern', () => {
    const output = 'SPEC ISSUE: The acceptance criteria are contradictory';
    const result = parseDeveloperOutput(output);
    expect(result.blocked).toBe(true);
    expect(result.blockerReason).toBe('The acceptance criteria are contradictory');
  });

  it('handles JSON blocker with blocker_reason field', () => {
    const output = '{"blocked": true, "blocker_reason": "Missing config file"}';
    const result = parseDeveloperOutput(output);
    expect(result.blocked).toBe(true);
    expect(result.blockerReason).toBe('Missing config file');
  });

  it('returns blocked false when JSON has blocked=false', () => {
    const output = '{"blocked": false, "reason": ""}';
    const result = parseDeveloperOutput(output);
    expect(result.blocked).toBe(false);
  });
});

describe('PipelineExecutor.execute - success determination', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('reports success=false when all agent runs failed', async () => {
    // Import mocked modules
    const { getAutoAgents, createAutoAgentRun, updateAutoAgentRun, getAllAutoSettings, getAutoUserPrompts } = await import('../../src/lib/autonomous/db');
    const { PipelineExecutor } = await import('../../src/lib/autonomous/pipeline-executor');

    // Setup: two agents (developer and qa_engineer), both will fail
    const mockAgents = [
      { id: 'agent-1', name: 'developer', display_name: 'Developer', pipeline_order: 1, enabled: 1 },
      { id: 'agent-2', name: 'qa_engineer', display_name: 'QA Engineer', pipeline_order: 2, enabled: 1 },
    ];

    (getAllAutoSettings as ReturnType<typeof vi.fn>).mockReturnValue({
      skip_designer_for_fixes: false,
      review_max_iterations: 1,
      max_designer_iterations: 1,
    });
    (getAutoAgents as ReturnType<typeof vi.fn>).mockReturnValue(mockAgents);
    (getAutoUserPrompts as ReturnType<typeof vi.fn>).mockReturnValue([]);

    let agentRunCounter = 0;
    (createAutoAgentRun as ReturnType<typeof vi.fn>).mockImplementation((params: Record<string, unknown>) => {
      agentRunCounter++;
      return {
        id: `run-${agentRunCounter}`,
        cycle_id: params.cycle_id,
        agent_id: params.agent_id,
        agent_name: params.agent_name,
        iteration: params.iteration,
        status: 'running',
        prompt: params.prompt,
        output: '',
        cost_usd: null,
        duration_ms: null,
        started_at: new Date().toISOString(),
        completed_at: null,
      } as AutoAgentRun;
    });

    (updateAutoAgentRun as ReturnType<typeof vi.fn>).mockImplementation((_id: string, updates: Partial<AutoAgentRun>) => {
      return { id: _id, ...updates } as AutoAgentRun;
    });

    // Mock ClaudeExecutor to immediately call onComplete with isError=true (simulating failure)
    mockClaudeExecutorImpl = (_binary, _onEvent, _onRateLimit, onComplete) => ({
      execute: () => {
        // Simulate agent failure (not rate limit)
        onComplete({ cost_usd: 0.01, duration_ms: 100, output: 'Error occurred', isError: true });
      },
      kill: vi.fn(),
    });

    const mockSession = {
      id: 'session-1',
      target_project: '/tmp/test-project',
      status: 'running' as const,
      total_cycles: 0,
      total_cost_usd: 0,
      config: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const emitFn = vi.fn();
    const executor = new PipelineExecutor(mockSession, 'cycle-1', 1, emitFn);
    const result = await executor.execute();

    // BUG: All agents failed, but QA agent has status 'failed' (not 'completed'),
    // so qaResult is undefined, and !undefined = true -> pipeline falsely reports success
    expect(result.success).toBe(false);
    expect(result.agentRuns).toHaveLength(2);
    expect(result.agentRuns.every(r => r.status === 'failed')).toBe(true);
  });
});

describe('filterAgentsByPipelineType', () => {
  const makeAgent = (name: string, order: number): AutoAgent => ({
    id: `agent-${name}`,
    name,
    display_name: name.charAt(0).toUpperCase() + name.slice(1).replace(/_/g, ' '),
    role_description: '',
    system_prompt: '',
    model: 'sonnet',
    pipeline_order: order,
    parallel_group: null,
    enabled: 1,
    is_builtin: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  const allAgents: AutoAgent[] = [
    makeAgent('planning_team_lead', 0.5),
    makeAgent('developer', 1.0),
    makeAgent('test_engineer', 1.0),
    makeAgent('smoke_tester', 3.5),
  ];

  it('discovery pipeline keeps planning, developer, smoke_tester; drops only test_engineer', () => {
    const result = filterAgentsByPipelineType(allAgents, 'discovery');
    const names = result.map(a => a.name).sort();
    expect(names).toEqual(['developer', 'planning_team_lead', 'smoke_tester']);
  });

  it('fix pipeline returns only developer and smoke_tester', () => {
    const result = filterAgentsByPipelineType(allAgents, 'fix');
    const names = result.map(a => a.name).sort();
    expect(names).toEqual(['developer', 'smoke_tester']);
  });

  it('fix pipeline omits smoke_tester if it is not in the enabled set', () => {
    const noSmoke = allAgents.filter(a => a.name !== 'smoke_tester');
    const result = filterAgentsByPipelineType(noSmoke, 'fix');
    const names = result.map(a => a.name);
    expect(names).toEqual(['developer']);
  });

  it('test_fix pipeline returns only test_engineer', () => {
    const result = filterAgentsByPipelineType(allAgents, 'test_fix');
    const names = result.map(a => a.name);
    expect(names).toEqual(['test_engineer']);
  });

  it('default (undefined) behaves like discovery — drops test_engineer only', () => {
    const result = filterAgentsByPipelineType(allAgents, undefined);
    const names = result.map(a => a.name);
    expect(names).toContain('developer');
    expect(names).toContain('planning_team_lead');
    expect(names).toContain('smoke_tester');
    expect(names).not.toContain('test_engineer');
  });
});

describe('extractSmokeScreenshots', () => {
  it('returns screenshot path when file exists on disk', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-test-'));
    const screenshotPath = path.join(tmpDir, 'SMOKE-01.png');
    fs.writeFileSync(screenshotPath, 'fake png data');

    const output = JSON.stringify({
      test_case_file: '/proj/smoke-test.md',
      summary: { total: 1, passed: 0, failed: 1, new_failed: 1, skipped: 0 },
      failures: [
        {
          test_id: 'SMOKE-01',
          test_name: 'Library screen loads',
          expected: 'Score cards visible',
          actual: 'Blank white screen',
          screenshot: screenshotPath,
          severity: 'critical',
        },
      ],
    });

    const result = extractSmokeScreenshots(output);
    expect(result).toEqual([screenshotPath]);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('excludes screenshot paths that do not exist on disk', () => {
    const output = JSON.stringify({
      summary: { total: 1, passed: 0, failed: 1, new_failed: 1, skipped: 0 },
      failures: [
        {
          test_id: 'SMOKE-01',
          test_name: 'PDF renders',
          screenshot: '/nonexistent/path/SMOKE-01.png',
          severity: 'critical',
        },
      ],
    });

    const result = extractSmokeScreenshots(output);
    expect(result).toEqual([]);
  });

  it('returns empty array when output has no failures array', () => {
    const output = JSON.stringify({
      summary: { total: 2, passed: 2, failed: 0, new_failed: 0, skipped: 0 },
      failures: [],
    });

    const result = extractSmokeScreenshots(output);
    expect(result).toEqual([]);
  });

  it('returns empty array on unparseable output', () => {
    const result = extractSmokeScreenshots('This is not JSON at all');
    expect(result).toEqual([]);
  });

  it('returns empty array on empty string', () => {
    const result = extractSmokeScreenshots('');
    expect(result).toEqual([]);
  });

  it('handles multiple failures and filters by file existence', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-test-'));
    const existingPath = path.join(tmpDir, 'SMOKE-01.png');
    fs.writeFileSync(existingPath, 'fake png');
    const missingPath = '/nonexistent/SMOKE-02.png';

    const output = JSON.stringify({
      summary: { total: 2, passed: 0, failed: 2, new_failed: 2, skipped: 0 },
      failures: [
        { test_id: 'SMOKE-01', screenshot: existingPath, severity: 'critical' },
        { test_id: 'SMOKE-02', screenshot: missingPath, severity: 'critical' },
      ],
    });

    const result = extractSmokeScreenshots(output);
    expect(result).toEqual([existingPath]);
    expect(result).not.toContain(missingPath);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe('extractSmokeFailures', () => {
  it('returns test_name and screenshot for each failure (happy path)', () => {
    const output = JSON.stringify({
      test_case_file: '/proj/smoke-test.md',
      summary: { total: 2, passed: 0, failed: 2, new_failed: 2, skipped: 0 },
      failures: [
        {
          test_id: 'SMOKE-01',
          test_name: 'Library screen loads',
          screenshot: '/screenshots/SMOKE-01.png',
          severity: 'critical',
        },
        {
          test_id: 'SMOKE-02',
          test_name: 'Settings panel opens',
          screenshot: '/screenshots/SMOKE-02.png',
          severity: 'major',
        },
      ],
    });

    const result = extractSmokeFailures(output);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ test_name: 'Library screen loads', screenshot: '/screenshots/SMOKE-01.png' });
    expect(result[1]).toEqual({ test_name: 'Settings panel opens', screenshot: '/screenshots/SMOKE-02.png' });
  });

  it('returns partial entries: one with name but no screenshot, another with screenshot but no name', () => {
    const output = JSON.stringify({
      summary: { total: 2, passed: 0, failed: 2, new_failed: 2, skipped: 0 },
      failures: [
        {
          test_id: 'SMOKE-01',
          test_name: 'Name only failure',
          severity: 'critical',
          // no screenshot field
        },
        {
          test_id: 'SMOKE-02',
          screenshot: '/screenshots/SMOKE-02.png',
          severity: 'critical',
          // no test_name field
        },
      ],
    });

    const result = extractSmokeFailures(output);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ test_name: 'Name only failure' });
    expect(result[1]).toEqual({ screenshot: '/screenshots/SMOKE-02.png' });
  });

  it('returns empty array when failures array is empty', () => {
    const output = JSON.stringify({
      summary: { total: 2, passed: 2, failed: 0, new_failed: 0, skipped: 0 },
      failures: [],
    });

    const result = extractSmokeFailures(output);
    expect(result).toEqual([]);
  });

  it('returns empty array on unparseable output', () => {
    const result = extractSmokeFailures('This is not JSON at all');
    expect(result).toEqual([]);
  });

  it('does NOT filter by file existence — returns screenshot paths even when files are missing', () => {
    const output = JSON.stringify({
      summary: { total: 1, passed: 0, failed: 1, new_failed: 1, skipped: 0 },
      failures: [
        {
          test_name: 'Nonexistent screenshot test',
          screenshot: '/nonexistent/path/SMOKE-01.png',
        },
      ],
    });

    const result = extractSmokeFailures(output);
    expect(result).toHaveLength(1);
    expect(result[0].screenshot).toBe('/nonexistent/path/SMOKE-01.png');
  });
});
