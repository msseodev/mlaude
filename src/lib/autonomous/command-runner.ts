import { spawn } from 'child_process';

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const MAX_OUTPUT_SIZE = 512 * 1024; // 512KB

export interface CommandResult {
  passed: boolean;        // exitCode === 0
  exitCode: number | null;
  output: string;         // stdout + stderr
  duration_ms: number;
}

/**
 * Run a generic shell command and return the result.
 * Returns null if the command is empty or blank.
 */
export async function runCommand(
  command: string,
  cwd: string,
  timeoutMs?: number,
): Promise<CommandResult | null> {
  if (!command || !command.trim()) {
    return null;
  }

  const effectiveTimeout = timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const startTime = Date.now();

  return new Promise<CommandResult>((resolve) => {
    let stdout = '';
    let stderr = '';
    let killed = false;

    const child = spawn(command, [], {
      shell: true,
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const timeout = setTimeout(() => {
      killed = true;
      child.kill('SIGTERM');
      // Force kill after 5 seconds if still alive
      setTimeout(() => {
        if (!child.killed) {
          child.kill('SIGKILL');
        }
      }, 5000);
    }, effectiveTimeout);

    child.stdout?.on('data', (data: Buffer) => {
      if (stdout.length < MAX_OUTPUT_SIZE) {
        stdout += data.toString();
      }
    });

    child.stderr?.on('data', (data: Buffer) => {
      if (stderr.length < MAX_OUTPUT_SIZE) {
        stderr += data.toString();
      }
    });

    child.on('close', (code: number | null) => {
      clearTimeout(timeout);

      const duration_ms = Date.now() - startTime;
      const output = stdout + (stderr ? '\n' + stderr : '');
      const exitCode = killed ? null : code;
      const passed = !killed && code === 0;

      resolve({
        passed,
        output,
        exitCode,
        duration_ms,
      });
    });

    child.on('error', (err: Error) => {
      clearTimeout(timeout);

      const duration_ms = Date.now() - startTime;

      resolve({
        passed: false,
        output: `Process error: ${err.message}`,
        exitCode: null,
        duration_ms,
      });
    });
  });
}
