import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execFile } from 'child_process';

vi.mock('child_process', () => ({
  execFile: vi.fn(),
}));

const mockExecFile = vi.mocked(execFile);

import { GitManager } from '../../src/lib/autonomous/git-manager';

describe('GitManager.commitCycleResult', () => {
  beforeEach(() => {
    mockExecFile.mockReset();
  });

  it('calls git add, diff --cached, commit with the given message when there are changes', async () => {
    const callOrder: string[][] = [];
    mockExecFile.mockImplementation((_cmd: unknown, args: unknown, _opts: unknown, cb: unknown) => {
      const argsArr = args as string[];
      const callback = cb as (err: Error | null, result: { stdout: string; stderr: string }) => void;
      callOrder.push([...argsArr]);
      if (argsArr[0] === 'diff' && argsArr.includes('--cached') && argsArr.includes('--quiet')) {
        callback(new Error('exit code 1'), { stdout: '', stderr: '' });
      } else if (argsArr[0] === 'rev-parse' && argsArr[1] === 'HEAD') {
        callback(null, { stdout: 'abc123def\n', stderr: '' });
      } else {
        callback(null, { stdout: '', stderr: '' });
      }
      return {} as ReturnType<typeof execFile>;
    });

    const gm = new GitManager('/tmp/test-project');
    const sha = await gm.commitCycleResult('test commit message');

    expect(sha).toBe('abc123def');

    // Verify git add -A was called
    expect(callOrder[0]).toEqual(['add', '-A']);

    // Verify git diff --cached --quiet was called
    expect(callOrder[1]).toEqual(['diff', '--cached', '--quiet']);

    // Verify git commit with correct message was called
    expect(callOrder[2]).toEqual(['commit', '-m', 'test commit message']);

    // Verify rev-parse HEAD was called to get the SHA
    expect(callOrder[3]).toEqual(['rev-parse', 'HEAD']);
  });

  it('skips commit when there are no staged changes', async () => {
    const callOrder: string[][] = [];
    mockExecFile.mockImplementation((_cmd: unknown, args: unknown, _opts: unknown, cb: unknown) => {
      const argsArr = args as string[];
      const callback = cb as (err: Error | null, result: { stdout: string; stderr: string }) => void;
      callOrder.push([...argsArr]);
      if (argsArr[0] === 'rev-parse' && argsArr[1] === 'HEAD') {
        callback(null, { stdout: 'existing-sha\n', stderr: '' });
      } else {
        // Exit code 0 for diff --cached --quiet means no changes
        callback(null, { stdout: '', stderr: '' });
      }
      return {} as ReturnType<typeof execFile>;
    });

    const gm = new GitManager('/tmp/test-project');
    const sha = await gm.commitCycleResult('should not commit');

    expect(sha).toBe('existing-sha');

    // Verify commit was NOT called
    const commitCalls = callOrder.filter(args => args[0] === 'commit');
    expect(commitCalls).toHaveLength(0);
  });

  it('returns null when git add fails', async () => {
    mockExecFile.mockImplementation((_cmd: unknown, args: unknown, _opts: unknown, cb: unknown) => {
      const argsArr = args as string[];
      const callback = cb as (err: Error | null, result: { stdout: string; stderr: string }) => void;
      if (argsArr[0] === 'add') {
        callback(new Error('fatal: not a git repository'), { stdout: '', stderr: '' });
      } else {
        callback(null, { stdout: '', stderr: '' });
      }
      return {} as ReturnType<typeof execFile>;
    });

    const gm = new GitManager('/tmp/test-project');
    const sha = await gm.commitCycleResult('will fail');

    expect(sha).toBeNull();
  });

  it('passes multi-line commit messages correctly', async () => {
    const callOrder: string[][] = [];
    mockExecFile.mockImplementation((_cmd: unknown, args: unknown, _opts: unknown, cb: unknown) => {
      const argsArr = args as string[];
      const callback = cb as (err: Error | null, result: { stdout: string; stderr: string }) => void;
      callOrder.push([...argsArr]);
      if (argsArr[0] === 'diff' && argsArr.includes('--cached') && argsArr.includes('--quiet')) {
        callback(new Error('exit code 1'), { stdout: '', stderr: '' });
      } else if (argsArr[0] === 'rev-parse' && argsArr[1] === 'HEAD') {
        callback(null, { stdout: 'sha456\n', stderr: '' });
      } else {
        callback(null, { stdout: '', stderr: '' });
      }
      return {} as ReturnType<typeof execFile>;
    });

    const multiLineMsg = '[mclaude-auto] cycle 3: Fix login bug\n\nFinding: P0 - Fix login bug\nAgents: Developer(completed) -> Reviewer(completed)\nCost: $0.50 | Duration: 2.3min';
    const gm = new GitManager('/tmp/test-project');
    await gm.commitCycleResult(multiLineMsg);

    const commitCall = callOrder.find(args => args[0] === 'commit');
    expect(commitCall).toBeDefined();
    expect(commitCall![2]).toBe(multiLineMsg);
  });
});
