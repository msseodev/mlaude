import { spawn, execFileSync, ChildProcess } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { StreamParser } from './stream-parser';
import { RateLimitDetector } from './rate-limit-detector';
import type { ClaudeEvent, SSEEvent, RateLimitInfo } from './types';

export class ClaudeExecutor {
  private process: ChildProcess | null = null;
  private streamParser: StreamParser;
  private rateLimitDetector: RateLimitDetector;
  private killed: boolean = false;
  private completed: boolean = false;
  private accumulatedOutput: string = '';
  private accumulatedStderr: string = '';
  private lastCostUsd: number | null = null;
  private lastDurationMs: number | null = null;
  private inToolUse: boolean = false;
  private currentToolName: string = 'unknown';
  private hasReceivedStreamingDeltas: boolean = false;
  private exitSafetyTimer: NodeJS.Timeout | null = null;

  constructor(
    private claudeBinary: string,
    private onEvent: (event: SSEEvent) => void,
    private onRateLimit: (info: RateLimitInfo) => void,
    private onComplete: (result: { cost_usd: number | null; duration_ms: number | null; output: string; isError: boolean; isAuthError: boolean; exitCode: number | null }) => void,
  ) {
    this.streamParser = new StreamParser();
    this.rateLimitDetector = new RateLimitDetector();
  }

  private resolveBinary(binary: string): string {
    if (path.isAbsolute(binary)) return binary;
    try {
      return execFileSync('which', [binary], { encoding: 'utf-8' }).trim();
    } catch {
      throw new Error(`Claude binary '${binary}' not found in PATH. Please set the absolute path in Settings.`);
    }
  }

  execute(promptContent: string, workingDirectory: string, model?: string, logFile?: string): void {
    this.killed = false;
    this.completed = false;
    if (this.exitSafetyTimer) { clearTimeout(this.exitSafetyTimer); this.exitSafetyTimer = null; }
    this.accumulatedOutput = '';
    this.accumulatedStderr = '';
    this.lastCostUsd = null;
    this.lastDurationMs = null;
    this.inToolUse = false;
    this.hasReceivedStreamingDeltas = false;

    const resolvedBinary = this.resolveBinary(this.claudeBinary);
    const resolvedCwd = workingDirectory.startsWith('~')
      ? path.join(os.homedir(), workingDirectory.slice(1))
      : workingDirectory;

    const args = [
      '-p', promptContent,
      '--output-format', 'stream-json',
      '--include-partial-messages',
      '--verbose',
      '--dangerously-skip-permissions',
      '--append-system-prompt', `You are an autonomous agent. Make all decisions independently and proceed without asking the user for guidance, clarification, or confirmation. Never ask "How should we proceed?" or similar questions. Just do the work.

## Sub-agent & External Resource Rules
- NEVER spawn a sub-agent (Agent tool) that downloads files from external websites. Download files directly yourself using WebFetch, curl, or wget.
- If a download fails after 2 attempts, skip it and move on. Do NOT retry indefinitely.
- NEVER wait on a single sub-agent for more than 5 minutes. If a sub-agent appears stuck, abandon it and proceed with available results.
- When spawning parallel sub-agents, set a mental deadline. If some agents complete but others are stuck, finalize with the results you have.
- Prefer direct tool calls over delegating to sub-agents for simple tasks like file downloads.`,
    ];

    if (model) {
      args.push('--model', model);
    }

    // Build env without CLAUDECODE to prevent nesting
    const env = { ...process.env };
    delete env.CLAUDECODE;
    delete env.CLAUDE_CODE_ENTRYPOINT;

    this.process = spawn(resolvedBinary, args, {
      cwd: resolvedCwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    if (logFile) {
      const dir = path.dirname(logFile);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(logFile, `[${new Date().toISOString()}] Process started: PID=${this.process?.pid}\n`);
    }

    this.process.stdout?.on('data', (data: Buffer) => {
      const chunk = data.toString();
      const events = this.streamParser.parse(chunk);
      for (const event of events) {
        this.processEvent(event);
      }
    });

    this.process.stderr?.on('data', (data: Buffer) => {
      const text = data.toString();
      this.accumulatedStderr += text;
      console.error(`[claude-executor stderr] ${text.trim()}`);
      if (logFile) {
        fs.appendFileSync(logFile, `[${new Date().toISOString()}] [stderr] ${text}`);
      }
    });

    this.process.on('close', (code: number | null) => {
      if (logFile) {
        fs.appendFileSync(logFile, `[${new Date().toISOString()}] Process exited: code=${code}\n`);
      }

      // Flush remaining buffer
      const remaining = this.streamParser.flush();
      for (const event of remaining) {
        this.processEvent(event);
      }

      if (this.completed || this.killed) return;
      this.completed = true;
      if (this.exitSafetyTimer) { clearTimeout(this.exitSafetyTimer); this.exitSafetyTimer = null; }

      // Check for rate limit via exit code
      const exitCodeCheck = this.rateLimitDetector.checkExitCode(code);
      if (exitCodeCheck.detected) {
        this.onRateLimit(exitCodeCheck);
        return;
      }

      const isError = code !== null && code !== 0;

      // Only check text patterns for rate limit on non-zero exit to avoid false positives
      if (isError) {
        const textCheck = this.rateLimitDetector.checkText(this.accumulatedOutput + this.accumulatedStderr);
        if (textCheck.detected) {
          this.onRateLimit(textCheck);
          return;
        }
      }

      // Check for auth errors only on non-zero exit to avoid false positives
      let isAuthError = false;
      if (isError) {
        const combinedText = this.accumulatedOutput + this.accumulatedStderr;
        const authCheck = this.rateLimitDetector.checkAuthError(combinedText);
        isAuthError = authCheck.detected;
      }

      // Include stderr in output when there's an error for debugging
      let output = this.accumulatedOutput;
      if (isError && this.accumulatedStderr) {
        output = output
          ? `${output}\n\n[stderr]\n${this.accumulatedStderr}`
          : `[stderr]\n${this.accumulatedStderr}`;
      }

      this.onComplete({
        cost_usd: this.lastCostUsd,
        duration_ms: this.lastDurationMs,
        output,
        isError,
        isAuthError,
        exitCode: code,
      });
    });

    this.process.on('error', (err: Error) => {
      console.error(`[claude-executor] Process error: ${err.message}`);
      if (logFile) {
        fs.appendFileSync(logFile, `[${new Date().toISOString()}] Process error: ${err.message}\n`);
      }
      if (this.completed || this.killed) return;
      this.completed = true;
      if (this.exitSafetyTimer) { clearTimeout(this.exitSafetyTimer); this.exitSafetyTimer = null; }
      this.onComplete({
        cost_usd: null,
        duration_ms: null,
        output: `Process error: ${err.message}`,
        isError: true,
        isAuthError: false,
        exitCode: null,
      });
    });

    // Safety net: 'exit' fires when the process exits, 'close' fires when stdio streams close.
    // They can fire in either order, and 'close' might not fire if stdio is held open.
    this.process.on('exit', (code: number | null, signal: string | null) => {
      if (logFile) {
        fs.appendFileSync(logFile, `[${new Date().toISOString()}] Process exit event: code=${code} signal=${signal}\n`);
      }
      // If close/error handler hasn't completed within 10s, force complete
      this.exitSafetyTimer = setTimeout(() => {
        this.exitSafetyTimer = null;
        if (this.completed || this.killed) return;
        this.completed = true;
        if (logFile) {
          fs.appendFileSync(logFile, `[${new Date().toISOString()}] Force completing via exit safety net\n`);
        }
        const remaining = this.streamParser.flush();
        for (const event of remaining) {
          this.processEvent(event);
        }
        // Guard: processEvent flush may have triggered kill/complete via rate limit detection
        if (this.killed) return;

        // Check for rate limit via exit code
        const exitCodeCheck = this.rateLimitDetector.checkExitCode(code);
        if (exitCodeCheck.detected) {
          this.onRateLimit(exitCodeCheck);
          return;
        }

        const isError = code !== null && code !== 0;

        if (isError) {
          const textCheck = this.rateLimitDetector.checkText(this.accumulatedOutput + this.accumulatedStderr);
          if (textCheck.detected) {
            this.onRateLimit(textCheck);
            return;
          }
        }

        let isAuthError = false;
        if (isError) {
          const authCheck = this.rateLimitDetector.checkAuthError(this.accumulatedOutput + this.accumulatedStderr);
          isAuthError = authCheck.detected;
        }

        let output = this.accumulatedOutput;
        if (isError && this.accumulatedStderr) {
          output = output
            ? `${output}\n\n[stderr]\n${this.accumulatedStderr}`
            : `[stderr]\n${this.accumulatedStderr}`;
        }
        this.onComplete({
          cost_usd: this.lastCostUsd,
          duration_ms: this.lastDurationMs,
          output,
          isError,
          isAuthError,
          exitCode: code,
        });
      }, 10000);
    });
  }

  private processEvent(event: ClaudeEvent): void {
    if (this.killed) return;

    // Check stream event for rate limits
    const rateLimitCheck = this.rateLimitDetector.checkStreamEvent(event);
    if (rateLimitCheck.detected) {
      this.kill();
      this.onRateLimit(rateLimitCheck);
      return;
    }

    switch (event.type) {
      case 'content_block_delta': {
        const delta = (event as { delta?: { type?: string; text?: string } }).delta;
        if (delta?.type === 'text_delta' && delta.text) {
          this.hasReceivedStreamingDeltas = true;
          this.accumulatedOutput += delta.text;
          this.emitSSE('text_delta', { text: delta.text });
        }
        break;
      }

      case 'content_block_start': {
        const block = (event as { content_block?: { type?: string; name?: string; id?: string } }).content_block;
        if (block?.type === 'tool_use') {
          this.inToolUse = true;
          this.currentToolName = block.name ?? 'unknown';
          this.emitSSE('tool_start', { tool: this.currentToolName, id: block.id ?? '' });
        }
        break;
      }

      case 'content_block_stop': {
        if (this.inToolUse) {
          this.inToolUse = false;
          this.emitSSE('tool_end', { tool: this.currentToolName });
          this.currentToolName = 'unknown';
        }
        break;
      }

      case 'assistant': {
        // Fallback: only use assistant message text if no streaming deltas were received
        // to avoid double-counting output
        if (!this.hasReceivedStreamingDeltas) {
          const msg = (event as { message?: { content?: Array<{ type: string; text?: string }> } }).message;
          if (msg?.content) {
            for (const block of msg.content) {
              if (block.type === 'text' && block.text) {
                this.accumulatedOutput += block.text;
                this.emitSSE('text_delta', { text: block.text });
              }
            }
          }
        }
        break;
      }

      case 'result': {
        const result = event as { cost_usd?: number; duration_ms?: number; total_cost_usd?: number };
        if (result.cost_usd !== undefined) this.lastCostUsd = result.cost_usd;
        if (result.total_cost_usd !== undefined) this.lastCostUsd = result.total_cost_usd;
        if (result.duration_ms !== undefined) this.lastDurationMs = result.duration_ms;
        break;
      }
    }
  }

  private emitSSE(type: SSEEvent['type'], data: Record<string, unknown>): void {
    this.onEvent({
      type,
      data,
      timestamp: new Date().toISOString(),
    });
  }

  kill(): void {
    this.killed = true;
    this.completed = true;
    if (this.exitSafetyTimer) { clearTimeout(this.exitSafetyTimer); this.exitSafetyTimer = null; }
    const proc = this.process;
    if (proc && !proc.killed) {
      proc.kill('SIGTERM');
      // Force kill after 5 seconds if still alive
      setTimeout(() => {
        if (!proc.killed) {
          proc.kill('SIGKILL');
        }
      }, 5000);
    }
    this.process = null;
  }

  isRunning(): boolean {
    return this.process !== null && !this.process.killed && !this.killed;
  }
}
