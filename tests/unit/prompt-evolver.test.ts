import { describe, it, expect } from 'vitest';
import { evaluateAgentPerformance, shouldRollback } from '@/lib/autonomous/prompt-evolver';
import type { PromptVariant } from '@/lib/autonomous/types';

function makeVariant(overrides: Partial<PromptVariant> = {}): PromptVariant {
  return {
    id: 'variant-1',
    agent_id: 'agent-1',
    system_prompt: 'Test prompt',
    parent_variant_id: null,
    generation: 0,
    status: 'active',
    avg_score: null,
    cycles_evaluated: 0,
    created_at: '2026-03-14T00:00:00Z',
    ...overrides,
  };
}

describe('evaluateAgentPerformance', () => {
  it('should return shouldEvolve=true when avg score < 40 (absolute floor)', () => {
    // Build cycles with low scores where the agent participated
    const recentScores = [30, 35, 38, 32, 28]; // avg ~32.6
    const olderScores = [70, 75, 80]; // baseline
    const result = evaluateAgentPerformance(
      'agent-1',
      recentScores,
      olderScores,
      5,
    );
    expect(result.shouldEvolve).toBe(true);
    expect(result.reason).toContain('below absolute floor');
    expect(result.currentAvgScore).toBeLessThan(40);
  });

  it('should return shouldEvolve=true when avg score drops 10%+ from baseline', () => {
    // Baseline avg = 80, recent avg = 70 (12.5% drop)
    const recentScores = [68, 72, 70, 71, 69]; // avg = 70
    const olderScores = [78, 82, 80]; // avg = 80
    const result = evaluateAgentPerformance(
      'agent-1',
      recentScores,
      olderScores,
      5,
    );
    expect(result.shouldEvolve).toBe(true);
    expect(result.reason).toContain('decline');
    expect(result.currentAvgScore).toBeCloseTo(70, 0);
  });

  it('should return shouldEvolve=false when performing well', () => {
    const recentScores = [85, 88, 90, 87, 86]; // avg ~87.2
    const olderScores = [80, 82, 78]; // avg = 80
    const result = evaluateAgentPerformance(
      'agent-1',
      recentScores,
      olderScores,
      5,
    );
    expect(result.shouldEvolve).toBe(false);
    expect(result.reason).toBe('Performance acceptable');
  });

  it('should return shouldEvolve=false when insufficient data (< 3 cycles)', () => {
    const recentScores = [85, 88]; // only 2 cycles
    const olderScores: number[] = [];
    const result = evaluateAgentPerformance(
      'agent-1',
      recentScores,
      olderScores,
      5,
    );
    expect(result.shouldEvolve).toBe(false);
    expect(result.reason).toContain('Insufficient');
  });

  it('should return shouldEvolve=false when recent scores are empty', () => {
    const recentScores: number[] = [];
    const olderScores = [80, 82, 78];
    const result = evaluateAgentPerformance(
      'agent-1',
      recentScores,
      olderScores,
      5,
    );
    expect(result.shouldEvolve).toBe(false);
  });

  it('should return shouldEvolve=true when exactly at 10% decline boundary', () => {
    // Baseline avg = 80, recent avg = 71.6 (10.5% drop -> should evolve)
    const recentScores = [70, 72, 71, 73, 72]; // avg = 71.6
    const olderScores = [80, 80, 80]; // avg = 80
    const result = evaluateAgentPerformance(
      'agent-1',
      recentScores,
      olderScores,
      5,
    );
    // 71.6 < 80 * 0.9 = 72, so should evolve
    expect(result.shouldEvolve).toBe(true);
  });

  it('should not trigger decline when no older cycles exist', () => {
    const recentScores = [50, 55, 48, 52, 45]; // avg = 50
    const olderScores: number[] = []; // no baseline
    const result = evaluateAgentPerformance(
      'agent-1',
      recentScores,
      olderScores,
      5,
    );
    // Score > 40 and no baseline to compare -> should evolve=false
    expect(result.shouldEvolve).toBe(false);
    expect(result.reason).toBe('Performance acceptable');
  });
});

describe('shouldRollback', () => {
  it('should return keepActive=true when new variant performs better', () => {
    const evaluating = makeVariant({
      id: 'new-variant',
      status: 'evaluating',
      avg_score: 80,
      cycles_evaluated: 5,
    });
    const previous = makeVariant({
      id: 'old-variant',
      status: 'active',
      avg_score: 70,
    });

    const result = shouldRollback(evaluating, previous);
    expect(result.keepActive).toBe(true);
    expect(result.reason).toContain('>=');
  });

  it('should return keepActive=false when new variant is worse by >5 points', () => {
    const evaluating = makeVariant({
      id: 'new-variant',
      status: 'evaluating',
      avg_score: 60,
      cycles_evaluated: 5,
    });
    const previous = makeVariant({
      id: 'old-variant',
      status: 'active',
      avg_score: 70,
    });

    const result = shouldRollback(evaluating, previous);
    expect(result.keepActive).toBe(false);
    expect(result.reason).toContain('rolling back');
  });

  it('should return keepActive=true when insufficient evaluation cycles', () => {
    const evaluating = makeVariant({
      id: 'new-variant',
      status: 'evaluating',
      avg_score: 30,
      cycles_evaluated: 2, // < 3
    });
    const previous = makeVariant({
      id: 'old-variant',
      status: 'active',
      avg_score: 90,
    });

    const result = shouldRollback(evaluating, previous);
    expect(result.keepActive).toBe(true);
    expect(result.reason).toContain('Not enough');
  });

  it('should return keepActive=true when difference within noise margin (<=5 points)', () => {
    const evaluating = makeVariant({
      id: 'new-variant',
      status: 'evaluating',
      avg_score: 67,
      cycles_evaluated: 5,
    });
    const previous = makeVariant({
      id: 'old-variant',
      status: 'active',
      avg_score: 70,
    });

    const result = shouldRollback(evaluating, previous);
    // Difference is 3 points (<=5), so keep active
    expect(result.keepActive).toBe(true);
    expect(result.reason).toContain('noise margin');
  });

  it('should return keepActive=true when scores are equal', () => {
    const evaluating = makeVariant({
      id: 'new-variant',
      status: 'evaluating',
      avg_score: 75,
      cycles_evaluated: 5,
    });
    const previous = makeVariant({
      id: 'old-variant',
      status: 'active',
      avg_score: 75,
    });

    const result = shouldRollback(evaluating, previous);
    expect(result.keepActive).toBe(true);
  });

  it('should handle null previous variant (no baseline)', () => {
    const evaluating = makeVariant({
      id: 'new-variant',
      status: 'evaluating',
      avg_score: 50,
      cycles_evaluated: 5,
    });

    const result = shouldRollback(evaluating, null);
    expect(result.keepActive).toBe(true);
  });

  it('should return keepActive=false when exactly at 5-point boundary', () => {
    const evaluating = makeVariant({
      id: 'new-variant',
      status: 'evaluating',
      avg_score: 64.9,
      cycles_evaluated: 5,
    });
    const previous = makeVariant({
      id: 'old-variant',
      status: 'active',
      avg_score: 70,
    });

    // Difference is 5.1, which is > 5
    const result = shouldRollback(evaluating, previous);
    expect(result.keepActive).toBe(false);
  });
});
