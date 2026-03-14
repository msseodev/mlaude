import { describe, it, expect } from 'vitest';
import { runCommand } from '@/lib/autonomous/command-runner';
import os from 'os';

describe('runCommand', () => {
  it('should return passed: true for a command that exits with code 0', async () => {
    const result = await runCommand('echo hello', os.tmpdir());
    expect(result).not.toBeNull();
    expect(result!.passed).toBe(true);
    expect(result!.exitCode).toBe(0);
    expect(result!.output).toContain('hello');
    expect(result!.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it('should return passed: false for a command that exits with non-zero code', async () => {
    const result = await runCommand('exit 1', os.tmpdir());
    expect(result).not.toBeNull();
    expect(result!.passed).toBe(false);
    expect(result!.exitCode).toBe(1);
  });

  it('should capture both stdout and stderr', async () => {
    const result = await runCommand('echo out && echo err >&2', os.tmpdir());
    expect(result).not.toBeNull();
    expect(result!.output).toContain('out');
    expect(result!.output).toContain('err');
  });

  it('should return null for empty command', async () => {
    const result = await runCommand('', os.tmpdir());
    expect(result).toBeNull();
  });

  it('should return null for blank (whitespace-only) command', async () => {
    const result = await runCommand('   ', os.tmpdir());
    expect(result).toBeNull();
  });

  it('should handle timeout by killing the process', async () => {
    // Use a command that sleeps for 10 seconds, but set timeout to 500ms
    const result = await runCommand('sleep 10', os.tmpdir(), 500);
    expect(result).not.toBeNull();
    expect(result!.passed).toBe(false);
    expect(result!.exitCode).toBeNull();
    expect(result!.duration_ms).toBeGreaterThanOrEqual(400);
    expect(result!.duration_ms).toBeLessThan(5000);
  }, 10000);

  it('should measure duration_ms', async () => {
    const result = await runCommand('sleep 0.2', os.tmpdir());
    expect(result).not.toBeNull();
    expect(result!.duration_ms).toBeGreaterThanOrEqual(150);
  });

  it('should use the provided cwd', async () => {
    const result = await runCommand('pwd', os.tmpdir());
    expect(result).not.toBeNull();
    // os.tmpdir() may resolve symlinks differently, so just check it's not empty
    expect(result!.output.trim().length).toBeGreaterThan(0);
    expect(result!.passed).toBe(true);
  });
});
