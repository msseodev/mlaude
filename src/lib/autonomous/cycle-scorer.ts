import type { PipelineResult } from './pipeline-executor';
import type { CommandResult } from './command-runner';
import type { AutoAgentRun } from './types';
import { parseQACounts } from './cycle-engine';

export interface CycleScore {
  build_passed: boolean | null;     // null = not configured
  lint_passed: boolean | null;
  test_pass_rate: number | null;    // 0.0~1.0
  test_passed: boolean | null;
  reviewer_approved: boolean | null;
  review_iterations: number;
  developer_blocked: boolean;
  finding_resolved: boolean;
  new_findings_count: number;
  cost_usd: number;
  duration_ms: number;
  composite_score: number;          // 0~100
}

export function scoreCycle(
  pipelineResult: PipelineResult,
  commandResults: { build?: CommandResult; lint?: CommandResult },
  agentRuns: AutoAgentRun[],
  findingResolved: boolean,
  newFindingsCount: number,
  medianCost: number,
  maxReviewIterations: number = 3,
): CycleScore {
  // --- Extract signals ---

  const buildPassed = commandResults.build ? commandResults.build.passed : null;
  const lintPassed = commandResults.lint ? commandResults.lint.passed : null;

  // Test data from QA result
  let testPassRate: number | null = null;
  let testPassed: boolean | null = null;
  if (pipelineResult.qaResult) {
    testPassed = pipelineResult.qaResult.passed;
    const counts = parseQACounts(pipelineResult.qaResult.testOutput);
    if (counts.total !== null && counts.total > 0 && counts.passed !== null) {
      testPassRate = counts.passed / counts.total;
    } else {
      // qaResult exists but no parseable counts: use passed/failed boolean
      testPassRate = pipelineResult.qaResult.passed ? 1.0 : 0.0;
    }
  }

  // Reviewer data
  const reviewerRuns = agentRuns.filter(
    r => r.agent_name.toLowerCase().includes('reviewer')
  );
  const reviewIterations = reviewerRuns.length;

  let reviewerApproved: boolean | null = null;
  if (reviewerRuns.length > 0) {
    const lastReview = reviewerRuns[reviewerRuns.length - 1];
    try {
      const jsonMatch = lastReview.output.match(/\{[\s\S]*"approved"\s*:\s*(true|false)[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        reviewerApproved = !!parsed.approved;
      }
    } catch {
      // Fallback to string matching
      if (lastReview.output.includes('"approved": true') || lastReview.output.includes('"approved":true')) {
        reviewerApproved = true;
      } else if (lastReview.output.includes('"approved": false') || lastReview.output.includes('"approved":false')) {
        reviewerApproved = false;
      }
    }
  }

  // Developer blocker
  const developerBlocked = agentRuns.some(
    r => r.agent_name.toLowerCase().includes('developer') &&
      (r.output.includes('BLOCKER') || r.output.includes('SPEC ISSUE'))
  );

  // --- Compute scores ---

  // L0 Gate (25pts): Both build & lint pass (or not configured) -> 25, either fails -> 0
  const buildOk = buildPassed === null || buildPassed === true;
  const lintOk = lintPassed === null || lintPassed === true;
  const l0 = (buildOk && lintOk) ? 25 : 0;

  // L1 Test (30pts): test_pass_rate * 30, no test data -> 30
  let l1: number;
  if (testPassRate === null) {
    l1 = 30;
  } else {
    l1 = testPassRate * 30;
  }

  // L2 Process (20pts)
  let l2 = 0;
  // Reviewer approved -> +10, not -> +0, null (no reviewer) -> +10 (neutral)
  if (reviewerApproved === null) {
    l2 += 10;
  } else if (reviewerApproved === true) {
    l2 += 10;
  }
  // Iterations: 10 * max(0, 1 - review_iterations / maxReviewIterations)
  l2 += 10 * Math.max(0, 1 - reviewIterations / maxReviewIterations);
  // Developer blocked -> -5
  if (developerBlocked) {
    l2 -= 5;
  }
  l2 = Math.max(0, l2);

  // Value (15pts)
  let value = 0;
  if (findingResolved) {
    value = 15;
  } else if (newFindingsCount > 0) {
    value = 5;
  }

  // Efficiency (10pts)
  let efficiency: number;
  if (medianCost > 0) {
    const costRatio = Math.min(pipelineResult.totalCostUsd / medianCost, 2) / 2;
    efficiency = 10 * (1 - costRatio);
  } else {
    efficiency = 5;
  }

  // Total composite
  let composite = l0 + l1 + l2 + value + efficiency;

  // L0 fail -> cap total at 25
  if (l0 === 0) {
    composite = Math.min(composite, 25);
  }

  // Round to avoid floating-point artifacts
  composite = Math.round(composite * 100) / 100;

  return {
    build_passed: buildPassed,
    lint_passed: lintPassed,
    test_pass_rate: testPassRate,
    test_passed: testPassed,
    reviewer_approved: reviewerApproved,
    review_iterations: reviewIterations,
    developer_blocked: developerBlocked,
    finding_resolved: findingResolved,
    new_findings_count: newFindingsCount,
    cost_usd: pipelineResult.totalCostUsd,
    duration_ms: pipelineResult.totalDurationMs,
    composite_score: composite,
  };
}
