import { describe, it, expect } from 'vitest';
import { buildCycleDoc } from '../../src/lib/autonomous/cycle-engine';
import type { PipelineResult } from '../../src/lib/autonomous/pipeline-executor';
import type { AutoAgentRun, AutoFinding } from '../../src/lib/autonomous/types';

function makeAgentRun(overrides: Partial<AutoAgentRun> = {}): AutoAgentRun {
  return {
    id: 'run-1',
    cycle_id: 'cycle-1',
    agent_id: 'agent-1',
    agent_name: 'Developer',
    iteration: 1,
    status: 'completed',
    prompt: '',
    output: '',
    cost_usd: null,
    duration_ms: null,
    started_at: new Date().toISOString(),
    completed_at: null,
    ...overrides,
  };
}

function makePipelineResult(overrides: Partial<PipelineResult> = {}): PipelineResult {
  return {
    success: true,
    agentRuns: [],
    finalOutput: '',
    totalCostUsd: 0,
    totalDurationMs: 0,
    ...overrides,
  };
}

function makeFinding(overrides: Partial<AutoFinding> = {}): AutoFinding {
  return {
    id: 'finding-1',
    session_id: 'session-1',
    category: 'bug',
    priority: 'P0',
    title: 'Fix login button',
    description: 'The login button does not work',
    file_path: null,
    status: 'in_progress',
    retry_count: 0,
    max_retries: 3,
    resolved_by_cycle_id: null,
    failure_history: null,
    created_at: '2026-03-01T00:00:00.000Z',
    updated_at: '2026-03-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('buildCycleDoc', () => {
  it('generates correct markdown header with cycle number, date, cost and duration', () => {
    const result = makePipelineResult({
      agentRuns: [makeAgentRun({ agent_name: 'Developer', status: 'completed' })],
      totalCostUsd: 0.45,
      totalDurationMs: 120000,
    });
    const finding = makeFinding({ priority: 'P1', title: 'Fix button', category: 'bug' });

    const doc = buildCycleDoc(3, finding, result, '2026-03-01T10:30:00.000Z');

    expect(doc).toContain('# Cycle 3 Summary');
    expect(doc).toContain('- **Date**: 2026-03-01T10:30:00.000Z');
    expect(doc).toContain('- **Status**: completed');
    expect(doc).toContain('- **Cost**: $0.45');
    expect(doc).toContain('- **Duration**: 2.0min');
  });

  it('includes finding section with priority, title, and category', () => {
    const result = makePipelineResult({
      agentRuns: [makeAgentRun()],
      totalCostUsd: 0.10,
      totalDurationMs: 60000,
    });
    const finding = makeFinding({
      priority: 'P2',
      title: 'Improve error handling',
      category: 'improvement',
    });

    const doc = buildCycleDoc(5, finding, result, '2026-03-01T12:00:00.000Z');

    expect(doc).toContain('## Finding');
    expect(doc).toContain('- **Priority**: P2');
    expect(doc).toContain('- **Title**: Improve error handling');
    expect(doc).toContain('- **Category**: improvement');
  });

  it('shows "N/A" for finding section when no finding is provided', () => {
    const result = makePipelineResult({
      agentRuns: [makeAgentRun()],
      totalCostUsd: 0,
      totalDurationMs: 0,
    });

    const doc = buildCycleDoc(1, null, result, '2026-03-01T00:00:00.000Z');

    expect(doc).toContain('## Finding');
    expect(doc).toContain('- **Priority**: N/A');
    expect(doc).toContain('- **Title**: N/A');
    expect(doc).toContain('- **Category**: N/A');
  });

  it('includes agent results with output summaries', () => {
    const result = makePipelineResult({
      agentRuns: [
        makeAgentRun({ agent_name: 'Product Designer', status: 'completed', output: 'Designed the form layout' }),
        makeAgentRun({ agent_name: 'Developer', status: 'completed', output: 'Implemented the fix for login' }),
        makeAgentRun({ agent_name: 'Reviewer', status: 'completed', output: 'Code looks good, no issues' }),
        makeAgentRun({ agent_name: 'QA Engineer', status: 'completed', output: 'All tests passing' }),
      ],
      totalCostUsd: 1.20,
      totalDurationMs: 300000,
    });

    const doc = buildCycleDoc(2, null, result, '2026-03-01T00:00:00.000Z');

    expect(doc).toContain('### Product Designer');
    expect(doc).toContain('Designed the form layout');
    expect(doc).toContain('### Developer');
    expect(doc).toContain('Implemented the fix for login');
    expect(doc).toContain('### Reviewer');
    expect(doc).toContain('Code looks good, no issues');
    expect(doc).toContain('### QA Engineer');
    expect(doc).toContain('All tests passing');
  });

  it('shows "skipped" for agents that were skipped', () => {
    const result = makePipelineResult({
      agentRuns: [
        makeAgentRun({ agent_name: 'Product Designer', status: 'skipped', output: '' }),
        makeAgentRun({ agent_name: 'Developer', status: 'completed', output: 'Did work' }),
      ],
      totalCostUsd: 0,
      totalDurationMs: 0,
    });

    const doc = buildCycleDoc(1, null, result, '2026-03-01T00:00:00.000Z');

    expect(doc).toContain('### Product Designer\nskipped');
  });

  it('includes QA results section with pass/fail counts from qaResult', () => {
    const result = makePipelineResult({
      agentRuns: [makeAgentRun({ agent_name: 'QA Engineer', status: 'completed' })],
      totalCostUsd: 0,
      totalDurationMs: 0,
      qaResult: { passed: true, testOutput: '5 passed, 1 failed, 6 total' },
    });

    const doc = buildCycleDoc(1, null, result, '2026-03-01T00:00:00.000Z');

    expect(doc).toContain('## QA Results');
    expect(doc).toContain('- Passed: 5');
    expect(doc).toContain('- Failed: 1');
    expect(doc).toContain('- Total: 6');
  });

  it('shows N/A for QA results when no qaResult is provided', () => {
    const result = makePipelineResult({
      agentRuns: [makeAgentRun()],
      totalCostUsd: 0,
      totalDurationMs: 0,
    });

    const doc = buildCycleDoc(1, null, result, '2026-03-01T00:00:00.000Z');

    expect(doc).toContain('## QA Results');
    expect(doc).toContain('- Passed: N/A');
    expect(doc).toContain('- Failed: N/A');
    expect(doc).toContain('- Total: N/A');
  });

  it('parses various test output formats for pass/fail counts', () => {
    const result = makePipelineResult({
      agentRuns: [makeAgentRun()],
      totalCostUsd: 0,
      totalDurationMs: 0,
      qaResult: { passed: true, testOutput: 'Tests: 10 passed, 2 failed, 12 total' },
    });

    const doc = buildCycleDoc(1, null, result, '2026-03-01T00:00:00.000Z');

    expect(doc).toContain('- Passed: 10');
    expect(doc).toContain('- Failed: 2');
    expect(doc).toContain('- Total: 12');
  });

  it('truncates long agent output to 500 characters', () => {
    const longOutput = 'A'.repeat(600);
    const result = makePipelineResult({
      agentRuns: [makeAgentRun({ agent_name: 'Developer', output: longOutput })],
      totalCostUsd: 0,
      totalDurationMs: 0,
    });

    const doc = buildCycleDoc(1, null, result, '2026-03-01T00:00:00.000Z');

    // Should contain truncated output (500 chars + "...")
    expect(doc).toContain('A'.repeat(500) + '...');
    expect(doc).not.toContain('A'.repeat(501));
  });

  it('handles zero cost and duration', () => {
    const result = makePipelineResult({
      agentRuns: [],
      totalCostUsd: 0,
      totalDurationMs: 0,
    });

    const doc = buildCycleDoc(1, null, result, '2026-03-01T00:00:00.000Z');

    expect(doc).toContain('- **Cost**: $0.00');
    expect(doc).toContain('- **Duration**: 0.0min');
  });
});
