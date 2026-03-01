import { describe, it, expect } from 'vitest';
import { buildCycleCommitMessage } from '../../src/lib/autonomous/cycle-engine';
import type { PipelineResult } from '../../src/lib/autonomous/pipeline-executor';
import type { AutoAgentRun } from '../../src/lib/autonomous/types';

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

describe('buildCycleCommitMessage', () => {
  it('includes finding title in the commit message title line', () => {
    const finding = { priority: 'P0', title: 'Fix login button' };
    const result = makePipelineResult({
      agentRuns: [makeAgentRun({ agent_name: 'Developer', status: 'completed' })],
      totalCostUsd: 0.45,
      totalDurationMs: 120000,
    });

    const msg = buildCycleCommitMessage(3, finding, result);

    expect(msg).toContain('[mclaude-auto] cycle 3: Fix login button');
    expect(msg).toContain('Finding: P0 - Fix login button');
  });

  it('uses generic title when no finding is provided', () => {
    const result = makePipelineResult({
      agentRuns: [makeAgentRun({ agent_name: 'Developer', status: 'completed' })],
      totalCostUsd: 0.10,
      totalDurationMs: 60000,
    });

    const msg = buildCycleCommitMessage(5, null, result);

    expect(msg).toContain('[mclaude-auto] cycle 5: Pipeline cycle completed');
    expect(msg).not.toContain('Finding:');
  });

  it('includes agent summary with statuses', () => {
    const result = makePipelineResult({
      agentRuns: [
        makeAgentRun({ agent_name: 'Developer', status: 'completed' }),
        makeAgentRun({ agent_name: 'Reviewer', status: 'completed' }),
        makeAgentRun({ agent_name: 'QA Engineer', status: 'failed' }),
      ],
      totalCostUsd: 1.23,
      totalDurationMs: 300000,
    });

    const msg = buildCycleCommitMessage(1, null, result);

    expect(msg).toContain('Agents: Developer(completed)');
    expect(msg).toContain('Reviewer(completed)');
    expect(msg).toContain('QA Engineer(failed)');
  });

  it('formats cost and duration correctly', () => {
    const result = makePipelineResult({
      agentRuns: [makeAgentRun()],
      totalCostUsd: 0.07,
      totalDurationMs: 150000, // 2.5 minutes
    });

    const msg = buildCycleCommitMessage(2, null, result);

    expect(msg).toContain('Cost: $0.07');
    expect(msg).toContain('Duration: 2.5min');
  });

  it('handles zero duration', () => {
    const result = makePipelineResult({
      agentRuns: [makeAgentRun()],
      totalCostUsd: 0,
      totalDurationMs: 0,
    });

    const msg = buildCycleCommitMessage(1, null, result);

    expect(msg).toContain('Duration: 0min');
    expect(msg).toContain('Cost: $0.00');
  });

  it('produces correct multi-line format', () => {
    const finding = { priority: 'P1', title: 'Improve error handling' };
    const result = makePipelineResult({
      agentRuns: [
        makeAgentRun({ agent_name: 'Developer', status: 'completed' }),
        makeAgentRun({ agent_name: 'Reviewer', status: 'completed' }),
      ],
      totalCostUsd: 0.50,
      totalDurationMs: 180000,
    });

    const msg = buildCycleCommitMessage(7, finding, result);
    const lines = msg.split('\n');

    // Title line
    expect(lines[0]).toBe('[mclaude-auto] cycle 7: Improve error handling');
    // Empty line after title
    expect(lines[1]).toBe('');
    // Finding info
    expect(lines[2]).toBe('Finding: P1 - Improve error handling');
    // Agent summary
    expect(lines[3]).toContain('Agents:');
    // Cost line
    expect(lines[4]).toContain('Cost:');
    expect(lines[4]).toContain('Duration:');
  });

  it('joins agent runs with arrow separator', () => {
    const result = makePipelineResult({
      agentRuns: [
        makeAgentRun({ agent_name: 'Developer', status: 'completed' }),
        makeAgentRun({ agent_name: 'Reviewer', status: 'completed' }),
      ],
      totalCostUsd: 0,
      totalDurationMs: 0,
    });

    const msg = buildCycleCommitMessage(1, null, result);

    // The arrow separator between agents
    expect(msg).toMatch(/Developer\(completed\).*→.*Reviewer\(completed\)/);
  });
});
