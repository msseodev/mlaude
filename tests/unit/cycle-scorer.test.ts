import { describe, it, expect } from 'vitest';
import { scoreCycle } from '@/lib/autonomous/cycle-scorer';
import type { PipelineResult } from '@/lib/autonomous/pipeline-executor';
import type { AutoAgentRun } from '@/lib/autonomous/types';
import type { CommandResult } from '@/lib/autonomous/command-runner';

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
    cost_usd: 0.1,
    duration_ms: 5000,
    started_at: '2026-03-14T00:00:00Z',
    completed_at: '2026-03-14T00:00:05Z',
    ...overrides,
  };
}

function makePipelineResult(overrides: Partial<PipelineResult> = {}): PipelineResult {
  return {
    success: true,
    agentRuns: [],
    finalOutput: 'done',
    totalCostUsd: 0.5,
    totalDurationMs: 30000,
    ...overrides,
  };
}

function makeCommandResult(overrides: Partial<CommandResult> = {}): CommandResult {
  return {
    passed: true,
    exitCode: 0,
    output: 'OK',
    duration_ms: 1000,
    ...overrides,
  };
}

describe('scoreCycle', () => {
  it('should return high composite score when all signals pass', () => {
    const result = makePipelineResult({
      qaResult: { passed: true, testOutput: '{"summary":{"passed":10,"failed":0,"total":10}}' },
      agentRuns: [
        makeAgentRun({ agent_name: 'Reviewer', output: '{"approved": true}' }),
      ],
    });
    const commands = {
      build: makeCommandResult({ passed: true }),
      lint: makeCommandResult({ passed: true }),
    };

    const score = scoreCycle(result, commands, result.agentRuns, true, 0, 0.5);

    // L0=25, L1=30, L2=20, Value=15, Efficiency>=5 => near 95-100
    expect(score.composite_score).toBeGreaterThanOrEqual(90);
    expect(score.build_passed).toBe(true);
    expect(score.lint_passed).toBe(true);
    expect(score.test_pass_rate).toBe(1.0);
    expect(score.test_passed).toBe(true);
    expect(score.reviewer_approved).toBe(true);
    expect(score.finding_resolved).toBe(true);
  });

  it('should cap composite score at 25 when build fails', () => {
    const result = makePipelineResult({
      qaResult: { passed: true, testOutput: '{"summary":{"passed":10,"failed":0,"total":10}}' },
      agentRuns: [
        makeAgentRun({ agent_name: 'Reviewer', output: '{"approved": true}' }),
      ],
    });
    const commands = {
      build: makeCommandResult({ passed: false, exitCode: 1 }),
      lint: makeCommandResult({ passed: true }),
    };

    const score = scoreCycle(result, commands, result.agentRuns, true, 0, 0.5);

    expect(score.composite_score).toBeLessThanOrEqual(25);
    expect(score.build_passed).toBe(false);
  });

  it('should cap composite score at 25 when lint fails', () => {
    const result = makePipelineResult({
      qaResult: { passed: true, testOutput: '{"summary":{"passed":10,"failed":0,"total":10}}' },
      agentRuns: [
        makeAgentRun({ agent_name: 'Reviewer', output: '{"approved": true}' }),
      ],
    });
    const commands = {
      build: makeCommandResult({ passed: true }),
      lint: makeCommandResult({ passed: false, exitCode: 1 }),
    };

    const score = scoreCycle(result, commands, result.agentRuns, true, 0, 0.5);

    expect(score.composite_score).toBeLessThanOrEqual(25);
    expect(score.lint_passed).toBe(false);
  });

  it('should not penalize when build/lint are not configured (null commandResults)', () => {
    const result = makePipelineResult({
      qaResult: { passed: true, testOutput: '{"summary":{"passed":10,"failed":0,"total":10}}' },
      agentRuns: [
        makeAgentRun({ agent_name: 'Reviewer', output: '{"approved": true}' }),
      ],
    });
    // No build or lint commands configured
    const commands = {};

    const score = scoreCycle(result, commands, result.agentRuns, true, 0, 0.5);

    // L0 should be full 25 (neutral)
    expect(score.build_passed).toBeNull();
    expect(score.lint_passed).toBeNull();
    expect(score.composite_score).toBeGreaterThanOrEqual(90);
  });

  it('should give proportional L1 score for partial test pass rate (8/10)', () => {
    const result = makePipelineResult({
      qaResult: { passed: false, testOutput: '{"summary":{"passed":8,"failed":2,"total":10}}' },
      agentRuns: [],
    });
    const commands = {
      build: makeCommandResult({ passed: true }),
      lint: makeCommandResult({ passed: true }),
    };

    const score = scoreCycle(result, commands, result.agentRuns, false, 0, 0.5);

    expect(score.test_pass_rate).toBeCloseTo(0.8, 2);
    expect(score.test_passed).toBe(false);
    // L1 = 0.8 * 30 = 24
    // We verify the test_pass_rate translates proportionally
    // Total should include L0=25, L1=24, L2 (some), Value=0, Efficiency (some)
    expect(score.composite_score).toBeGreaterThan(40);
    expect(score.composite_score).toBeLessThan(80);
  });

  it('should give full L1 marks when no test data is available', () => {
    const result = makePipelineResult({
      // No qaResult
      agentRuns: [],
    });
    const commands = {
      build: makeCommandResult({ passed: true }),
      lint: makeCommandResult({ passed: true }),
    };

    const score = scoreCycle(result, commands, result.agentRuns, false, 0, 0.5);

    // No test data => L1 = 30 (neutral)
    expect(score.test_pass_rate).toBeNull();
    expect(score.test_passed).toBeNull();
    // L0=25, L1=30, L2 with no reviewer=neutral, Value=0, Efficiency=some
    expect(score.composite_score).toBeGreaterThanOrEqual(65);
  });

  it('should give value bonus of 15 when finding is resolved', () => {
    const result = makePipelineResult({ agentRuns: [] });
    const commands = {
      build: makeCommandResult({ passed: true }),
      lint: makeCommandResult({ passed: true }),
    };

    const withResolved = scoreCycle(result, commands, result.agentRuns, true, 0, 0.5);
    const withoutResolved = scoreCycle(result, commands, result.agentRuns, false, 0, 0.5);

    // The difference should be exactly 15 (finding_resolved bonus)
    expect(withResolved.composite_score - withoutResolved.composite_score).toBe(15);
    expect(withResolved.finding_resolved).toBe(true);
    expect(withoutResolved.finding_resolved).toBe(false);
  });

  it('should give value bonus of 5 for new findings (no resolution)', () => {
    const result = makePipelineResult({ agentRuns: [] });
    const commands = {
      build: makeCommandResult({ passed: true }),
      lint: makeCommandResult({ passed: true }),
    };

    const withFindings = scoreCycle(result, commands, result.agentRuns, false, 3, 0.5);
    const withoutFindings = scoreCycle(result, commands, result.agentRuns, false, 0, 0.5);

    // New findings bonus = 5
    expect(withFindings.composite_score - withoutFindings.composite_score).toBe(5);
    expect(withFindings.new_findings_count).toBe(3);
  });

  it('should give lower L2 score when reviewer not approved and high iterations', () => {
    const reviewerRuns = [
      makeAgentRun({ agent_name: 'Reviewer', output: '{"approved": false}', iteration: 1 }),
      makeAgentRun({ agent_name: 'Reviewer', output: '{"approved": false}', iteration: 2 }),
      makeAgentRun({ agent_name: 'Reviewer', output: '{"approved": false}', iteration: 3 }),
    ];
    const result = makePipelineResult({
      agentRuns: reviewerRuns,
    });
    const commands = {
      build: makeCommandResult({ passed: true }),
      lint: makeCommandResult({ passed: true }),
    };

    const score = scoreCycle(result, commands, result.agentRuns, false, 0, 0.5);

    // reviewer_approved = false => +0 (instead of +10)
    // iterations = 3 => 10 * max(0, 1 - 3/3) = 0
    expect(score.reviewer_approved).toBe(false);
    expect(score.review_iterations).toBe(3);
    // L2 should be 0 (0 for approval + 0 for iterations)
    // Overall should be lower
    expect(score.composite_score).toBeLessThan(70);
  });

  it('should give lower efficiency score for very expensive cycles', () => {
    const result = makePipelineResult({
      totalCostUsd: 5.0,
      agentRuns: [],
    });
    const commands = {
      build: makeCommandResult({ passed: true }),
      lint: makeCommandResult({ passed: true }),
    };

    // medianCost is 0.5, but cycle cost is 5.0 (10x median)
    const score = scoreCycle(result, commands, result.agentRuns, false, 0, 0.5);

    // cost/median = 5/0.5 = 10, min(10, 2) = 2, efficiency = 10*(1-2/2) = 0
    expect(score.cost_usd).toBe(5.0);
    // L0=25, L1=30 (no test), L2=20 (no reviewer, neutral), Value=0, Efficiency=0
    // Total = 75
    expect(score.composite_score).toBe(75);
  });

  it('should detect developer blocker from agent runs', () => {
    const agentRuns = [
      makeAgentRun({ agent_name: 'Developer', output: 'BLOCKER: missing API endpoint' }),
    ];
    const result = makePipelineResult({ agentRuns });
    const commands = {
      build: makeCommandResult({ passed: true }),
      lint: makeCommandResult({ passed: true }),
    };

    const score = scoreCycle(result, commands, result.agentRuns, false, 0, 0.5);

    expect(score.developer_blocked).toBe(true);
  });

  it('should give default efficiency of 5 when medianCost is 0', () => {
    const result = makePipelineResult({
      totalCostUsd: 1.0,
      agentRuns: [],
    });
    const commands = {
      build: makeCommandResult({ passed: true }),
      lint: makeCommandResult({ passed: true }),
    };

    const score = scoreCycle(result, commands, result.agentRuns, false, 0, 0);

    // medianCost = 0 => efficiency = 5 (default)
    // L0=25, L1=30 (no test), L2=20 (no reviewer, neutral: 10 approval + 10 iterations), Value=0, Eff=5
    expect(score.composite_score).toBe(80);
  });
});
