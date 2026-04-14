import { describe, it, expect } from 'vitest';
import { FindingExtractor } from '@/lib/autonomous/finding-extractor';
import type { AutoFinding } from '@/lib/autonomous/types';

function makeFinding(overrides: Partial<AutoFinding> = {}): AutoFinding {
  return {
    id: 'finding-1',
    session_id: 'session-1',
    category: 'bug',
    priority: 'P2',
    title: 'Default finding title',
    description: 'Default description',
    file_path: null,
    status: 'open',
    retry_count: 0,
    max_retries: 3,
    resolved_by_cycle_id: null,
    failure_history: null,
    project_path: null,
    resolution_summary: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeClaudeOutput(findings: Array<{ title: string; category?: string; priority?: string; description?: string; file_path?: string | null }>): string {
  const json = JSON.stringify({
    findings: findings.map(f => ({
      title: f.title,
      category: f.category ?? 'bug',
      priority: f.priority ?? 'P2',
      description: f.description ?? 'A description',
      file_path: f.file_path ?? null,
    })),
  });
  return '```json\n' + json + '\n```';
}

describe('FindingExtractor', () => {
  const extractor = new FindingExtractor();

  describe('extract() basic functionality', () => {
    it('should return findings from valid JSON output', () => {
      const output = makeClaudeOutput([
        { title: 'Fix memory leak in worker pool', category: 'bug', priority: 'P1' },
        { title: 'Add error boundary to dashboard', category: 'improvement', priority: 'P2' },
      ]);

      const result = extractor.extract(output);
      expect(result).toHaveLength(2);
      expect(result[0].title).toBe('Fix memory leak in worker pool');
      expect(result[0].category).toBe('bug');
      expect(result[0].priority).toBe('P1');
      expect(result[1].title).toBe('Add error boundary to dashboard');
      expect(result[1].category).toBe('improvement');
    });
  });

  describe('extract() deduplicates against existingFindings (same session)', () => {
    it('should filter out findings that match existing ones by exact title', () => {
      const output = makeClaudeOutput([
        { title: 'Fix memory leak', category: 'bug' },
        { title: 'New feature idea', category: 'idea' },
      ]);

      const existing: AutoFinding[] = [
        makeFinding({ id: 'f1', title: 'Fix memory leak', status: 'open' }),
      ];

      const result = extractor.extract(output, existing);
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('New feature idea');
    });
  });

  describe('extract() deduplicates against crossSessionFindings (resolved)', () => {
    it('should filter out non-bug findings that were resolved in a previous session', () => {
      // Bugs bypass this dedup as regressions — see the "bug regression bypass" suite.
      // Non-bug categories still dedupe.
      const output = makeClaudeOutput([
        { title: 'Optimize worker pool allocation', category: 'performance' },
        { title: 'Brand new issue', category: 'improvement' },
      ]);

      const crossSession: AutoFinding[] = [
        makeFinding({
          id: 'cs-f1',
          session_id: 'old-session',
          title: 'Optimize worker pool allocation',
          category: 'performance',
          status: 'resolved',
          resolved_by_cycle_id: 'old-cycle-1',
        }),
      ];

      const result = extractor.extract(output, [], crossSession);
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Brand new issue');
    });
  });

  describe('extract() deduplicates against crossSessionFindings (wont_fix)', () => {
    it('should filter out findings that were marked wont_fix in a previous session', () => {
      const output = makeClaudeOutput([
        { title: 'Flaky test in CI pipeline', category: 'test_failure' },
        { title: 'Performance optimization needed', category: 'performance' },
      ]);

      const crossSession: AutoFinding[] = [
        makeFinding({
          id: 'cs-f2',
          session_id: 'old-session',
          title: 'Flaky test in CI pipeline',
          status: 'wont_fix',
        }),
      ];

      const result = extractor.extract(output, [], crossSession);
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Performance optimization needed');
    });
  });

  describe('extract() does NOT deduplicate when titles are different (cross-session)', () => {
    it('should keep findings whose titles do not match cross-session findings', () => {
      const output = makeClaudeOutput([
        { title: 'Completely new finding', category: 'bug' },
        { title: 'Another new finding', category: 'improvement' },
      ]);

      const crossSession: AutoFinding[] = [
        makeFinding({
          id: 'cs-f3',
          session_id: 'old-session',
          title: 'Totally different issue from before',
          status: 'resolved',
        }),
      ];

      const result = extractor.extract(output, [], crossSession);
      expect(result).toHaveLength(2);
    });
  });

  describe('extract() deduplicates when titles are similar but not exact (Dice > 0.8)', () => {
    it('should filter out non-bug findings with similar titles (Dice coefficient > 0.8)', () => {
      const output = makeClaudeOutput([
        { title: 'Optimize worker pool memory allocation', category: 'performance' },
        { title: 'Unrelated finding about security', category: 'security' },
      ]);

      // Very similar title (differs by minor wording)
      const crossSession: AutoFinding[] = [
        makeFinding({
          id: 'cs-f4',
          session_id: 'old-session',
          title: 'Optimize worker pool memory alloc',
          category: 'performance',
          status: 'resolved',
        }),
      ];

      const result = extractor.extract(output, [], crossSession);
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Unrelated finding about security');
    });
  });

  describe('extract() works with all three params as empty arrays', () => {
    it('should return all valid findings when existing and cross-session arrays are empty', () => {
      const output = makeClaudeOutput([
        { title: 'Finding one', category: 'bug' },
        { title: 'Finding two', category: 'improvement' },
      ]);

      const result = extractor.extract(output, [], []);
      expect(result).toHaveLength(2);
    });
  });

  describe('extract() handles crossSessionFindings as undefined (backward compat)', () => {
    it('should work when crossSessionFindings is not provided', () => {
      const output = makeClaudeOutput([
        { title: 'Some finding', category: 'bug' },
      ]);

      // Call with only two params (backward compatible)
      const result = extractor.extract(output, []);
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Some finding');
    });

    it('should work when both optional params are omitted', () => {
      const output = makeClaudeOutput([
        { title: 'Another finding', category: 'improvement' },
      ]);

      const result = extractor.extract(output);
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Another finding');
    });
  });

  describe('extract() combined same-session and cross-session dedup', () => {
    it('should deduplicate against both existing and cross-session findings simultaneously', () => {
      // Use non-bug categories so cross-session dedup applies; bugs have the
      // regression bypass which is exercised by a dedicated test suite above.
      const output = makeClaudeOutput([
        { title: 'Already in current session', category: 'improvement' },
        { title: 'Already resolved in old session', category: 'improvement' },
        { title: 'Truly new finding', category: 'improvement' },
      ]);

      const existing: AutoFinding[] = [
        makeFinding({ id: 'e1', title: 'Already in current session', category: 'improvement', status: 'open' }),
      ];

      const crossSession: AutoFinding[] = [
        makeFinding({
          id: 'cs1',
          session_id: 'old-session',
          title: 'Already resolved in old session',
          category: 'improvement',
          status: 'resolved',
        }),
      ];

      const result = extractor.extract(output, existing, crossSession);
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Truly new finding');
    });
  });

  describe('extract() bug regression bypass for resolved cross-session findings', () => {
    it('lets a bug through as P0 REGRESSION when title matches a RESOLVED cross-session bug', () => {
      const output = makeClaudeOutput([
        { title: 'PDF viewer crash on sample scores', category: 'bug', priority: 'P1' },
      ]);

      const crossSession: AutoFinding[] = [
        makeFinding({
          id: 'cs-resolved',
          session_id: 'old',
          title: 'PDF viewer crash on sample scores',
          category: 'bug',
          status: 'resolved',
        }),
      ];

      const result = extractor.extract(output, [], crossSession);
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('REGRESSION: PDF viewer crash on sample scores');
      expect(result[0].priority).toBe('P0');
    });

    it('still dedupes a non-bug category (e.g., improvement) matching a resolved finding', () => {
      const output = makeClaudeOutput([
        { title: 'Polish loading overlay', category: 'improvement', priority: 'P2' },
      ]);

      const crossSession: AutoFinding[] = [
        makeFinding({
          id: 'cs-resolved-imp',
          session_id: 'old',
          title: 'Polish loading overlay',
          category: 'improvement',
          status: 'resolved',
        }),
      ];

      const result = extractor.extract(output, [], crossSession);
      expect(result).toHaveLength(0);
    });

    it('still dedupes a bug matching a WONT_FIX cross-session finding (intentional skip)', () => {
      const output = makeClaudeOutput([
        { title: 'Flaky auth test', category: 'bug', priority: 'P1' },
      ]);

      const crossSession: AutoFinding[] = [
        makeFinding({
          id: 'cs-wontfix',
          session_id: 'old',
          title: 'Flaky auth test',
          category: 'bug',
          status: 'wont_fix',
        }),
      ];

      const result = extractor.extract(output, [], crossSession);
      expect(result).toHaveLength(0);
    });

    it('does not double-prefix an already-REGRESSION title', () => {
      const output = makeClaudeOutput([
        { title: 'REGRESSION: PDF viewer broken again', category: 'bug', priority: 'P1' },
      ]);

      const crossSession: AutoFinding[] = [
        makeFinding({
          id: 'cs-prev',
          session_id: 'old',
          title: 'REGRESSION: PDF viewer broken again',
          category: 'bug',
          status: 'resolved',
        }),
      ];

      const result = extractor.extract(output, [], crossSession);
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('REGRESSION: PDF viewer broken again');
    });
  });

  describe('extract() deduplicates within the same batch', () => {
    it('should filter out duplicate findings within a single LLM output', () => {
      const output = makeClaudeOutput([
        { title: '한국 가요/팝 악보 다운로드 및 E2E 테스트 확장', category: 'improvement' },
        { title: '한국 가요/팝 악보 다운로드 및 E2E 테스트 확장', category: 'improvement' },
        { title: '한국 가요/팝 악보 다운로드 및 E2E 테스트 확장', category: 'improvement' },
      ]);
      const result = extractor.extract(output);
      expect(result).toHaveLength(1);
    });

    it('should keep findings with different titles in the same batch', () => {
      const output = makeClaudeOutput([
        { title: 'Fix memory leak in worker pool', category: 'bug' },
        { title: 'Add accessibility labels to dashboard buttons', category: 'bug' },
        { title: 'Optimize database query performance for large datasets', category: 'improvement' },
      ]);
      const result = extractor.extract(output);
      expect(result).toHaveLength(3);
    });

    it('should filter similar titles within batch (Dice > 0.8)', () => {
      const output = makeClaudeOutput([
        { title: 'Fix memory leak in worker pool module', category: 'bug' },
        { title: 'Fix memory leak in the worker pool module', category: 'bug' },
      ]);
      const result = extractor.extract(output);
      expect(result).toHaveLength(1);
    });
  });
});
