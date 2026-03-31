import { describe, it, expect, vi, beforeEach } from 'vitest';
import { spawn, execFileSync } from 'child_process';

vi.mock('child_process', () => ({
  spawn: vi.fn(),
  execFileSync: vi.fn(),
}));

const mockSpawn = vi.mocked(spawn);
const mockExecFileSync = vi.mocked(execFileSync);

import { generateCommitMessage } from '../../src/lib/autonomous/summarizer';
import { EventEmitter } from 'events';
import { Readable } from 'stream';

function createMockProcess(stdout: string, exitCode: number = 0) {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: Readable;
    stderr: Readable;
    kill: ReturnType<typeof vi.fn>;
    pid: number;
  };
  proc.stdout = new Readable({ read() {} });
  proc.stderr = new Readable({ read() {} });
  proc.kill = vi.fn();
  proc.pid = 12345;

  // Emit data and close asynchronously
  setTimeout(() => {
    proc.stdout.push(stdout);
    proc.stdout.push(null);
    proc.emit('close', exitCode);
  }, 10);

  return proc;
}

describe('generateCommitMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecFileSync.mockReturnValue('/usr/local/bin/claude');
  });

  it('does not include [mlaude-auto] in the prompt', async () => {
    const proc = createMockProcess('feat: add user authentication');
    mockSpawn.mockReturnValue(proc as ReturnType<typeof spawn>);

    await generateCommitMessage('/usr/local/bin/claude', 'diff content here');

    // Check the prompt passed to spawn
    const spawnCall = mockSpawn.mock.calls[0];
    const args = spawnCall[1] as string[];
    const promptArgIndex = args.indexOf('-p');
    const prompt = args[promptArgIndex + 1];

    expect(prompt).not.toContain('[mlaude-auto]');
    expect(prompt).not.toContain('cycle');
  });

  it('uses conventional commit types in the prompt', async () => {
    const proc = createMockProcess('fix: resolve null pointer');
    mockSpawn.mockReturnValue(proc as ReturnType<typeof spawn>);

    await generateCommitMessage('/usr/local/bin/claude', 'diff content');

    const spawnCall = mockSpawn.mock.calls[0];
    const args = spawnCall[1] as string[];
    const promptArgIndex = args.indexOf('-p');
    const prompt = args[promptArgIndex + 1];

    expect(prompt).toContain('feat, fix, refactor, docs, test, chore');
  });

  it('returns empty string when Claude returns no output', async () => {
    const proc = createMockProcess('');
    mockSpawn.mockReturnValue(proc as ReturnType<typeof spawn>);

    const result = await generateCommitMessage('/usr/local/bin/claude', 'some diff');

    expect(result).toBe('');
  });

  it('returns the generated message on success', async () => {
    const proc = createMockProcess('feat: add login page\n\nImplement the user login page with form validation.');
    mockSpawn.mockReturnValue(proc as ReturnType<typeof spawn>);

    const result = await generateCommitMessage('/usr/local/bin/claude', 'diff here');

    expect(result).toBe('feat: add login page\n\nImplement the user login page with form validation.');
  });

  it('does not accept cycleNumber parameter', () => {
    // generateCommitMessage should only accept claudeBinary and gitDiff
    expect(generateCommitMessage.length).toBe(2);
  });
});
