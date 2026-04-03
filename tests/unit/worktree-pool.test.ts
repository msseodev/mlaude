import { describe, it, expect } from 'vitest';
import fs from 'fs/promises';

describe('WorkerPool worktree pool', () => {
  it('uses fixed pool paths (w0, w1, ...) instead of UUID-based paths', async () => {
    const source = await fs.readFile('src/lib/autonomous/parallel-coordinator.ts', 'utf-8');

    // Should have worktreePool field
    expect(source).toContain('worktreePool');

    // Should have initWorktreePool and destroyWorktreePool
    expect(source).toContain('initWorktreePool');
    expect(source).toContain('destroyWorktreePool');

    // Should NOT use uuidv4 for worktree paths anymore
    expect(source).not.toContain('uuidv4');

    // Fixed paths like w0, w1 instead of w${workerId}-${batchId}
    expect(source).toMatch(/`w\$\{i\}`/);
  });

  it('resets worktrees between cycles instead of recreating', async () => {
    const source = await fs.readFile('src/lib/autonomous/parallel-coordinator.ts', 'utf-8');

    // Should call resetWorktree instead of createWorktree per cycle
    expect(source).toContain('resetWorktree');
  });

  it('GitManager has resetWorktree method', async () => {
    const source = await fs.readFile('src/lib/autonomous/git-manager.ts', 'utf-8');

    expect(source).toContain('async resetWorktree');
    // Should reset to HEAD and clean
    expect(source).toContain('reset');
    expect(source).toContain('clean');
  });
});
