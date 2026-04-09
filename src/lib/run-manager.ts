import { ClaudeExecutor } from './claude-executor';
import { caffeinateManager } from './caffeinate';
import {
  getPrompts,
  getPrompt,
  updatePrompt,
  getNextPendingPrompt,
  resetPromptStatuses,
  createSession,
  getSession,
  updateSession,
  createExecution,
  getExecution,
  updateExecution,
  getSetting,
  getPlan,
  getPlanItems,
  createPlanItemRuns,
  getNextPendingPlanItemRun,
  updatePlanItemRun,
  getPlanItemRuns,
} from './db';
import type { SSEEvent, RateLimitInfo, RunStatus, SessionStatus } from './types';

const BACKOFF_BASE_MS = 5 * 60 * 1000; // 5 minutes
const BACKOFF_MAX_MS = 40 * 60 * 1000; // 40 minutes
const EVENT_BUFFER_SIZE = 500;

class RunManagerImpl {
  private executor: ClaudeExecutor | null = null;
  private currentSessionId: string | null = null;
  private currentExecutionId: string | null = null;
  private currentPlanId: string | null = null;
  private currentPlanItemRunId: string | null = null;
  private retryCount: number = 0;
  private retryTimer: NodeJS.Timeout | null = null;
  private waitingUntil: Date | null = null;
  private listeners: Set<(event: SSEEvent) => void> = new Set();
  private eventBuffer: SSEEvent[] = [];
  private currentOutput: string = '';

  // SSE listener management
  addListener(listener: (event: SSEEvent) => void): () => void {
    this.listeners.add(listener);
    // Send buffered events to new subscriber
    for (const event of this.eventBuffer) {
      listener(event);
    }
    return () => this.listeners.delete(listener);
  }

  private emit(event: SSEEvent): void {
    this.eventBuffer.push(event);
    if (this.eventBuffer.length > EVENT_BUFFER_SIZE) {
      this.eventBuffer = this.eventBuffer.slice(-EVENT_BUFFER_SIZE);
    }
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch {
        // Listener may have been disconnected
      }
    }
  }

  async startQueue(options?: {
    planId?: string;
    startFromPlanItemId?: string;
    startFromPromptId?: string;
  }): Promise<void> {
    // Guard against starting a queue while one is already running
    if (this.executor?.isRunning() || this.retryTimer) {
      throw new Error('Queue is already running');
    }

    // Note: manual mode and auto mode can run in parallel on different projects
    if (this.currentSessionId) {
      await this.stopQueue();
    }

    const planId = options?.planId;
    const startFromPlanItemId = options?.startFromPlanItemId;
    const startFromPromptId = options?.startFromPromptId;

    if (planId) {
      // --- Plan mode ---
      const plan = getPlan(planId);
      if (!plan) throw new Error('Plan not found');

      const items = getPlanItems(planId);
      if (items.length === 0) throw new Error('Plan has no items');

      // Create session with plan reference
      const session = createSession(planId);
      this.currentSessionId = session.id;
      this.currentPlanId = planId;

      // Determine start-from order
      let startFromItemOrder: number | undefined;
      if (startFromPlanItemId) {
        const targetItem = items.find(i => i.id === startFromPlanItemId);
        if (targetItem) {
          startFromItemOrder = targetItem.item_order;
        }
      }

      // Create plan item runs
      createPlanItemRuns(session.id, planId, startFromItemOrder);

      updateSession(session.id, { status: 'running' });
    } else {
      // --- Legacy mode ---
      if (startFromPromptId) {
        const targetPrompt = getPrompt(startFromPromptId);
        if (!targetPrompt) {
          throw new Error('Prompt not found');
        }
        resetPromptStatuses(targetPrompt.queue_order);
      } else {
        resetPromptStatuses();
      }

      const prompts = getPrompts().filter(p => p.status === 'pending');
      if (prompts.length === 0) {
        throw new Error('No pending prompts in queue');
      }

      const session = createSession();
      this.currentSessionId = session.id;
      this.currentPlanId = null;

      updateSession(session.id, { status: 'running' });
    }

    // Reset retry count and clear buffer for new run
    this.retryCount = 0;
    this.waitingUntil = null;
    this.eventBuffer = [];
    this.currentOutput = '';
    this.currentPlanItemRunId = null;

    caffeinateManager.acquire();

    this.emit({
      type: 'session_status',
      data: { status: 'running', sessionId: this.currentSessionId },
      timestamp: new Date().toISOString(),
    });

    this.safeProcessNext();
  }

  private safeProcessNext(): void {
    try {
      this.processNextPrompt();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      if (this.currentSessionId) {
        updateSession(this.currentSessionId, { status: 'stopped', current_prompt_id: null });
        this.emit({
          type: 'error',
          data: { message: `Queue error: ${message}` },
          timestamp: new Date().toISOString(),
        });
      }
      caffeinateManager.release();
      this.executor = null;
      this.currentSessionId = null;
      this.currentExecutionId = null;
      this.currentPlanId = null;
      this.currentPlanItemRunId = null;
    }
  }

  private processNextPrompt(): void {
    if (!this.currentSessionId) return;

    const session = getSession(this.currentSessionId);
    if (!session || session.status === 'stopped' || session.status === 'paused') return;

    if (this.currentPlanId) {
      this.processNextPlanItem();
    } else {
      this.processNextLegacyPrompt();
    }
  }

  private processNextLegacyPrompt(): void {
    if (!this.currentSessionId) return;

    const nextPrompt = getNextPendingPrompt();
    if (!nextPrompt) {
      // No more prompts, queue is complete
      updateSession(this.currentSessionId, { status: 'completed', current_prompt_id: null });
      this.emit({
        type: 'queue_complete',
        data: { sessionId: this.currentSessionId },
        timestamp: new Date().toISOString(),
      });
      this.currentSessionId = null;
      caffeinateManager.release();
      return;
    }

    // Update prompt status to running
    updatePrompt(nextPrompt.id, { status: 'running' });

    // Create execution record
    const execution = createExecution({
      prompt_id: nextPrompt.id,
      run_session_id: this.currentSessionId,
    });
    this.currentExecutionId = execution.id;
    this.currentOutput = '';

    // Update session's current prompt
    updateSession(this.currentSessionId, { current_prompt_id: nextPrompt.id });

    // Emit prompt_start event
    this.emit({
      type: 'prompt_start',
      data: {
        promptId: nextPrompt.id,
        promptTitle: nextPrompt.title,
        executionId: execution.id,
      },
      timestamp: new Date().toISOString(),
    });

    // Get working directory
    const workingDirectory = nextPrompt.working_directory || getSetting('working_directory') || process.cwd();
    const claudeBinary = getSetting('claude_binary') || 'claude';

    // Create executor and run
    this.executor = new ClaudeExecutor(
      claudeBinary,
      (event: SSEEvent) => {
        if (event.type === 'text_delta') {
          this.currentOutput += (event.data.text as string) || '';
        }
        this.emit(event);
      },
      (info: RateLimitInfo) => {
        this.handleRateLimit(info);
      },
      (result) => {
        this.handlePromptComplete(result);
      },
    );

    this.executor.execute(nextPrompt.content, workingDirectory, nextPrompt.model || undefined);
  }

  private processNextPlanItem(): void {
    if (!this.currentSessionId || !this.currentPlanId) return;

    const nextRun = getNextPendingPlanItemRun(this.currentSessionId);
    if (!nextRun) {
      // No more plan items, queue is complete
      updateSession(this.currentSessionId, { status: 'completed', current_prompt_id: null });
      this.emit({
        type: 'queue_complete',
        data: { sessionId: this.currentSessionId },
        timestamp: new Date().toISOString(),
      });
      this.currentSessionId = null;
      this.currentPlanId = null;
      this.currentPlanItemRunId = null;
      caffeinateManager.release();
      return;
    }

    // Mark plan item run as running
    updatePlanItemRun(nextRun.id, { status: 'running' });
    this.currentPlanItemRunId = nextRun.id;

    // Get the prompt details
    const prompt = getPrompt(nextRun.prompt_id);
    if (!prompt) {
      // Prompt was deleted, skip this item
      updatePlanItemRun(nextRun.id, { status: 'failed' });
      this.currentPlanItemRunId = null;
      this.safeProcessNext();
      return;
    }

    // Build effective prompt: global_prompt + plan_prompt + prompt_content
    const globalPrompt = getSetting('global_prompt') || '';
    const plan = getPlan(this.currentPlanId);
    const planPrompt = plan?.plan_prompt || '';

    const parts: string[] = [];
    if (globalPrompt.trim()) parts.push(globalPrompt.trim());
    if (planPrompt.trim()) parts.push(planPrompt.trim());
    parts.push(prompt.content);
    const effectivePrompt = parts.join('\n\n');

    // Create execution record
    const execution = createExecution({
      prompt_id: prompt.id,
      run_session_id: this.currentSessionId,
      plan_id: this.currentPlanId,
      effective_prompt: effectivePrompt,
    });
    this.currentExecutionId = execution.id;
    this.currentOutput = '';

    // Update session's current prompt
    updateSession(this.currentSessionId, { current_prompt_id: prompt.id });

    // Emit prompt_start event (with plan progress if in plan mode)
    this.emit({
      type: 'prompt_start',
      data: {
        promptId: prompt.id,
        promptTitle: prompt.title,
        executionId: execution.id,
        ...this.getPlanProgress(),
      },
      timestamp: new Date().toISOString(),
    });

    // Get working directory
    const workingDirectory = prompt.working_directory || getSetting('working_directory') || process.cwd();
    const claudeBinary = getSetting('claude_binary') || 'claude';

    // Create executor and run with effective prompt
    this.executor = new ClaudeExecutor(
      claudeBinary,
      (event: SSEEvent) => {
        if (event.type === 'text_delta') {
          this.currentOutput += (event.data.text as string) || '';
        }
        this.emit(event);
      },
      (info: RateLimitInfo) => {
        this.handleRateLimit(info);
      },
      (result) => {
        this.handlePromptComplete(result);
      },
    );

    this.executor.execute(effectivePrompt, workingDirectory, prompt.model || undefined);
  }

  private handlePromptComplete(result: { cost_usd: number | null; duration_ms: number | null; output: string; isError: boolean; isAuthError: boolean; exitCode: number | null }): void {
    if (!this.currentSessionId) return;

    const session = getSession(this.currentSessionId);
    if (!session) return;

    const promptId = session.current_prompt_id;
    if (!promptId) return;

    if (result.isAuthError) {
      // Update execution as failed
      if (this.currentExecutionId) {
        const execution = getExecution(this.currentExecutionId);
        const wallClockMs = execution?.started_at
          ? Date.now() - new Date(execution.started_at).getTime()
          : result.duration_ms;
        updateExecution(this.currentExecutionId, {
          status: 'failed',
          output: result.output,
          cost_usd: result.cost_usd,
          duration_ms: wallClockMs,
          completed_at: new Date().toISOString(),
        });
      }

      // Reset current prompt/plan item to pending for retry after re-login
      if (this.currentPlanId && this.currentPlanItemRunId) {
        updatePlanItemRun(this.currentPlanItemRunId, { status: 'pending' });
      } else {
        updatePrompt(promptId, { status: 'pending' });
      }

      // Pause the session
      updateSession(this.currentSessionId, { status: 'paused' });

      this.emit({
        type: 'auth_expired',
        data: {
          sessionId: this.currentSessionId,
          message: 'Claude CLI authentication expired. Please run `claude /login` in terminal and resume.',
        },
        timestamp: new Date().toISOString(),
      });

      this.executor = null;
      this.currentExecutionId = null;
      this.currentPlanItemRunId = null;
      caffeinateManager.release();
      return;
    }

    const now = new Date().toISOString();

    // Update execution record
    if (this.currentExecutionId) {
      // Calculate wall-clock duration from started_at
      const execution = getExecution(this.currentExecutionId);
      const wallClockMs = execution?.started_at
        ? Date.now() - new Date(execution.started_at).getTime()
        : result.duration_ms;

      updateExecution(this.currentExecutionId, {
        status: result.isError ? 'failed' : 'completed',
        output: result.output,
        cost_usd: result.cost_usd,
        duration_ms: wallClockMs,
        completed_at: now,
      });
    }

    const newStatus = result.isError ? 'failed' : 'completed';

    if (this.currentPlanId && this.currentPlanItemRunId) {
      // Plan mode: update plan_item_runs status
      updatePlanItemRun(this.currentPlanItemRunId, { status: newStatus });
    } else {
      // Legacy mode: update prompt status
      updatePrompt(promptId, { status: newStatus });
    }

    // Reset retry count on success
    if (!result.isError) {
      this.retryCount = 0;
    }

    const prompt = getPrompt(promptId);
    // Re-fetch execution to get the updated wall-clock duration
    const updatedExecution = this.currentExecutionId ? getExecution(this.currentExecutionId) : null;

    // Emit completion event (with plan progress if in plan mode)
    this.emit({
      type: result.isError ? 'prompt_failed' : 'prompt_complete',
      data: {
        promptId,
        promptTitle: prompt?.title ?? '',
        executionId: this.currentExecutionId,
        cost_usd: result.cost_usd,
        duration_ms: updatedExecution?.duration_ms ?? result.duration_ms,
        isError: result.isError,
        ...this.getPlanProgress(),
      },
      timestamp: new Date().toISOString(),
    });

    this.executor = null;
    this.currentExecutionId = null;
    this.currentPlanItemRunId = null;

    // Process next prompt in queue
    this.safeProcessNext();
  }

  /** Returns plan progress data to spread into SSE events, or empty object if not in plan mode */
  private getPlanProgress(): Record<string, unknown> {
    if (!this.currentPlanId || !this.currentSessionId) return {};
    const runs = getPlanItemRuns(this.currentSessionId);
    const total = runs.filter(r => r.status !== 'skipped').length;
    const completed = runs.filter(r => r.status === 'completed' || r.status === 'failed').length;
    const current = completed + 1; // the one currently running
    const plan = getPlan(this.currentPlanId);
    return {
      planName: plan?.name ?? null,
      planCurrent: current > total ? total : current,
      planTotal: total,
    };
  }

  private handleRateLimit(info: RateLimitInfo): void {
    if (!this.currentSessionId) return;

    const session = getSession(this.currentSessionId);
    if (!session) return;

    // Update session status
    updateSession(this.currentSessionId, { status: 'waiting_for_limit' });

    if (this.currentPlanId && this.currentPlanItemRunId) {
      // Plan mode: reset plan_item_run back to pending
      updatePlanItemRun(this.currentPlanItemRunId, { status: 'pending' });
    } else {
      // Legacy mode: reset current prompt back to pending
      if (session.current_prompt_id) {
        updatePrompt(session.current_prompt_id, { status: 'pending' });
      }
    }

    // Update execution as rate limited
    if (this.currentExecutionId) {
      updateExecution(this.currentExecutionId, {
        status: 'rate_limited',
        output: this.currentOutput,
        completed_at: new Date().toISOString(),
      });
    }

    // Use parsed reset time if available, otherwise fall back to exponential backoff
    const backoffMs = info.retryAfterMs
      ? info.retryAfterMs
      : Math.min(BACKOFF_BASE_MS * Math.pow(2, this.retryCount), BACKOFF_MAX_MS);
    this.waitingUntil = new Date(Date.now() + backoffMs);

    // Emit rate limit event
    this.emit({
      type: 'rate_limit',
      data: {
        message: info.message,
        source: info.source,
        retryAfterMs: backoffMs,
        waitingUntil: this.waitingUntil.toISOString(),
        retryCount: this.retryCount + 1,
      },
      timestamp: new Date().toISOString(),
    });

    // Schedule retry
    this.retryTimer = setTimeout(() => {
      this.retryAfterLimit();
    }, backoffMs);

    this.retryCount++;
    this.executor = null;
    this.currentExecutionId = null;
    this.currentPlanItemRunId = null;
  }

  private retryAfterLimit(): void {
    if (!this.currentSessionId) return;

    this.waitingUntil = null;
    this.retryTimer = null;

    const session = getSession(this.currentSessionId);
    if (!session || session.status === 'stopped' || session.status === 'paused') return;

    updateSession(this.currentSessionId, { status: 'running' });

    this.emit({
      type: 'session_status',
      data: { status: 'running', sessionId: this.currentSessionId },
      timestamp: new Date().toISOString(),
    });

    this.safeProcessNext();
  }

  async stopQueue(): Promise<void> {
    const hadSession = !!this.currentSessionId;

    // Kill executor if running
    if (this.executor) {
      this.executor.kill();
      this.executor = null;
    }

    // Clear retry timer
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.waitingUntil = null;

    // Update current prompt back to pending
    if (this.currentSessionId) {
      const session = getSession(this.currentSessionId);

      if (this.currentPlanId && this.currentPlanItemRunId) {
        // Plan mode: reset plan_item_run to pending
        updatePlanItemRun(this.currentPlanItemRunId, { status: 'pending' });
      } else if (session?.current_prompt_id) {
        updatePrompt(session.current_prompt_id, { status: 'pending' });
      }

      // Update execution if any
      if (this.currentExecutionId) {
        updateExecution(this.currentExecutionId, {
          status: 'failed',
          output: this.currentOutput,
          completed_at: new Date().toISOString(),
        });
      }

      updateSession(this.currentSessionId, { status: 'stopped', current_prompt_id: null });

      this.emit({
        type: 'queue_stopped',
        data: { sessionId: this.currentSessionId },
        timestamp: new Date().toISOString(),
      });
    }

    this.currentSessionId = null;
    this.currentExecutionId = null;
    this.currentPlanId = null;
    this.currentPlanItemRunId = null;
    if (hadSession) {
      caffeinateManager.release();
    }
  }

  async pauseQueue(): Promise<void> {
    const hadSession = !!this.currentSessionId;

    // Kill executor if running
    if (this.executor) {
      this.executor.kill();
      this.executor = null;
    }

    // Clear retry timer
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.waitingUntil = null;

    if (this.currentSessionId) {
      const session = getSession(this.currentSessionId);

      if (this.currentPlanId && this.currentPlanItemRunId) {
        // Plan mode: reset plan_item_run to pending
        updatePlanItemRun(this.currentPlanItemRunId, { status: 'pending' });
      } else if (session?.current_prompt_id) {
        // Legacy mode: update current prompt back to pending
        updatePrompt(session.current_prompt_id, { status: 'pending' });
      }

      // Update execution if any
      if (this.currentExecutionId) {
        updateExecution(this.currentExecutionId, {
          status: 'failed',
          output: this.currentOutput,
          completed_at: new Date().toISOString(),
        });
        this.currentExecutionId = null;
      }

      this.currentPlanItemRunId = null;

      updateSession(this.currentSessionId, { status: 'paused' });

      this.emit({
        type: 'session_status',
        data: { status: 'paused', sessionId: this.currentSessionId },
        timestamp: new Date().toISOString(),
      });
    }

    if (hadSession) {
      caffeinateManager.release();
    }
  }

  async resumeQueue(): Promise<void> {
    if (!this.currentSessionId) {
      throw new Error('No active session to resume');
    }

    const session = getSession(this.currentSessionId);
    if (!session || session.status !== 'paused') {
      throw new Error('Session is not paused');
    }

    caffeinateManager.acquire();

    updateSession(this.currentSessionId, { status: 'running' });

    this.emit({
      type: 'session_status',
      data: { status: 'running', sessionId: this.currentSessionId },
      timestamp: new Date().toISOString(),
    });

    this.safeProcessNext();
  }

  getStatus(): RunStatus {
    let completedCount = 0;
    let totalCount = 0;
    let planId: string | null = null;
    let planName: string | null = null;

    if (this.currentPlanId && this.currentSessionId) {
      // Plan mode: count from plan_item_runs
      const runs = getPlanItemRuns(this.currentSessionId);
      completedCount = runs.filter(r => r.status === 'completed').length;
      totalCount = runs.filter(r => r.status !== 'skipped').length;
      planId = this.currentPlanId;
      const plan = getPlan(this.currentPlanId);
      planName = plan?.name ?? null;
    } else {
      // Legacy mode: count from prompts
      const allPrompts = getPrompts();
      completedCount = allPrompts.filter(p => p.status === 'completed').length;
      totalCount = allPrompts.filter(p => p.status !== 'skipped').length;
    }

    let status: SessionStatus = 'idle';
    let currentPromptId: string | null = null;
    let currentPromptTitle: string | null = null;

    if (this.currentSessionId) {
      const session = getSession(this.currentSessionId);
      if (session) {
        status = session.status as SessionStatus;
        currentPromptId = session.current_prompt_id;
        if (currentPromptId) {
          const prompt = getPrompt(currentPromptId);
          currentPromptTitle = prompt?.title ?? null;
        }
      }
    }

    return {
      sessionId: this.currentSessionId,
      status,
      currentPromptId,
      currentPromptTitle,
      completedCount,
      totalCount,
      waitingUntil: this.waitingUntil?.toISOString() ?? null,
      retryCount: this.retryCount,
      planId,
      planName,
    };
  }

  clearBuffer(): void {
    this.eventBuffer = [];
  }
}

// globalThis singleton for HMR safety
const globalForRunManager = globalThis as unknown as { runManager: RunManagerImpl };
export const runManager = globalForRunManager.runManager || new RunManagerImpl();
globalForRunManager.runManager = runManager;
