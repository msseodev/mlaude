import { spawn, execFileSync, ChildProcess } from 'child_process';
import os from 'os';
import path from 'path';
import { StreamParser } from './stream-parser';
import type { ClaudeEvent, ChatSSEEvent } from './types';

export class ChatExecutor {
  private process: ChildProcess | null = null;
  private streamParser: StreamParser;
  private killed: boolean = false;
  private accumulatedOutput: string = '';
  private accumulatedStderr: string = '';
  private lastCostUsd: number | null = null;
  private lastDurationMs: number | null = null;
  private inToolUse: boolean = false;
  private currentToolName: string = 'unknown';
  private currentToolId: string = '';
  private accumulatedToolInput: string = '';
  private hasReceivedStreamingDeltas: boolean = false;

  constructor(
    private claudeBinary: string,
    private onEvent: (event: ChatSSEEvent) => void,
    private onComplete: (result: { cost_usd: number | null; duration_ms: number | null; output: string; isError: boolean }) => void,
  ) {
    this.streamParser = new StreamParser();
  }

  private resolveBinary(binary: string): string {
    if (path.isAbsolute(binary)) return binary;
    try {
      return execFileSync('which', [binary], { encoding: 'utf-8' }).trim();
    } catch {
      throw new Error(`Claude binary '${binary}' not found in PATH.`);
    }
  }

  execute(
    message: string,
    workingDirectory: string,
    options: {
      claudeSessionId?: string;  // for --resume (subsequent messages)
      newSessionId?: string;     // for --session-id (first message)
      model?: string;
      systemPrompt?: string;
    } = {}
  ): void {
    this.killed = false;
    this.accumulatedOutput = '';
    this.accumulatedStderr = '';
    this.lastCostUsd = null;
    this.lastDurationMs = null;
    this.inToolUse = false;
    this.accumulatedToolInput = '';
    this.hasReceivedStreamingDeltas = false;

    const resolvedBinary = this.resolveBinary(this.claudeBinary);
    const resolvedCwd = workingDirectory.startsWith('~')
      ? path.join(os.homedir(), workingDirectory.slice(1))
      : workingDirectory;

    const args = [
      '-p', message,
      '--output-format', 'stream-json',
      '--include-partial-messages',
      '--verbose',
    ];

    // Resume existing session or start new one
    if (options.claudeSessionId) {
      args.push('--resume', options.claudeSessionId);
    } else if (options.newSessionId) {
      args.push('--session-id', options.newSessionId);
    }

    if (options.model) {
      args.push('--model', options.model);
    }

    if (options.systemPrompt) {
      args.push('--append-system-prompt', options.systemPrompt);
    }

    // Read-only tools for chat mode
    args.push('--tools', 'Read,Glob,Grep,WebSearch,WebFetch');
    // Bypass permissions - non-interactive process can't respond to prompts
    args.push('--permission-mode', 'bypassPermissions');

    // Build env without CLAUDECODE to prevent nesting
    const env = { ...process.env };
    delete env.CLAUDECODE;
    delete env.CLAUDE_CODE_ENTRYPOINT;

    this.process = spawn(resolvedBinary, args, {
      cwd: resolvedCwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

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
    });

    this.process.on('close', (code: number | null) => {
      const remaining = this.streamParser.flush();
      for (const event of remaining) {
        this.processEvent(event);
      }

      if (this.killed) return;

      const isError = code !== null && code !== 0;
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
      });
    });

    this.process.on('error', (err: Error) => {
      if (!this.killed) {
        this.onComplete({
          cost_usd: null,
          duration_ms: null,
          output: `Process error: ${err.message}`,
          isError: true,
        });
      }
    });
  }

  private processEvent(rawEvent: ClaudeEvent): void {
    if (this.killed) return;

    // Unwrap stream_event wrapper
    let event = rawEvent;
    if (rawEvent.type === 'stream_event' && 'event' in rawEvent) {
      event = (rawEvent as { type: string; event: ClaudeEvent }).event;
    }

    switch (event.type) {
      case 'content_block_delta': {
        const delta = (event as { delta?: { type?: string; text?: string; partial_json?: string } }).delta;
        if (delta?.type === 'text_delta' && delta.text) {
          this.hasReceivedStreamingDeltas = true;
          this.accumulatedOutput += delta.text;
          this.emitSSE('text_delta', { text: delta.text });
        } else if (delta?.type === 'input_json_delta' && delta.partial_json !== undefined) {
          this.accumulatedToolInput += delta.partial_json;
        }
        break;
      }

      case 'content_block_start': {
        const block = (event as { content_block?: { type?: string; name?: string; id?: string } }).content_block;
        if (block?.type === 'tool_use') {
          this.inToolUse = true;
          this.currentToolName = block.name ?? 'unknown';
          this.currentToolId = block.id ?? '';
          this.accumulatedToolInput = '';
          this.emitSSE('tool_start', { tool: this.currentToolName, id: this.currentToolId });
        }
        break;
      }

      case 'content_block_stop': {
        if (this.inToolUse) {
          let parsedInput: Record<string, unknown> = {};
          try {
            parsedInput = JSON.parse(this.accumulatedToolInput);
          } catch {
            if (this.accumulatedToolInput) {
              parsedInput = { _raw: this.accumulatedToolInput };
            }
          }
          this.emitSSE('tool_input', { tool: this.currentToolName, id: this.currentToolId, input: parsedInput });

          this.inToolUse = false;
          this.emitSSE('tool_end', { tool: this.currentToolName });
          this.currentToolName = 'unknown';
          this.currentToolId = '';
          this.accumulatedToolInput = '';
        }
        break;
      }

      case 'user': {
        const userEvent = rawEvent as {
          type: string;
          message?: { content?: Array<{ type: string; tool_use_id?: string; content?: string; is_error?: boolean }> };
          tool_use_result?: { stdout?: string; stderr?: string; interrupted?: boolean };
        };
        if (userEvent.message?.content) {
          for (const block of userEvent.message.content) {
            if (block.type === 'tool_result') {
              this.emitSSE('tool_result', {
                tool_use_id: block.tool_use_id ?? '',
                content: block.content ?? '',
                is_error: block.is_error ?? false,
                stdout: userEvent.tool_use_result?.stdout ?? '',
                stderr: userEvent.tool_use_result?.stderr ?? '',
              });
            }
          }
        }
        break;
      }

      case 'assistant': {
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
        const result = event as { cost_usd?: number; duration_ms?: number; total_cost_usd?: number; session_id?: string };
        if (result.cost_usd !== undefined) this.lastCostUsd = result.cost_usd;
        if (result.total_cost_usd !== undefined) this.lastCostUsd = result.total_cost_usd;
        if (result.duration_ms !== undefined) this.lastDurationMs = result.duration_ms;
        break;
      }
    }
  }

  private emitSSE(type: ChatSSEEvent['type'], data: Record<string, unknown>): void {
    this.onEvent({
      type,
      data,
      timestamp: new Date().toISOString(),
    });
  }

  kill(): void {
    this.killed = true;
    const proc = this.process;
    if (proc && !proc.killed) {
      proc.kill('SIGTERM');
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
