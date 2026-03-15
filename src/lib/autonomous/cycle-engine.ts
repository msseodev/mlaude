import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { ClaudeExecutor } from '../claude-executor';
import { caffeinateManager } from '../caffeinate';
import { getSetting } from '../db';
import { PipelineExecutor } from './pipeline-executor';
import type { PipelineResult } from './pipeline-executor';
import { summarizeAgentOutputs, generateCommitMessage } from './summarizer';
import { runCommand } from './command-runner';
import type { CommandResult } from './command-runner';
import { scoreCycle } from './cycle-scorer';
import { checkAndEvolve } from './prompt-evolver';
import { getVariantHistory, updatePromptVariant } from './evolution-db';
import type { AutoUserPrompt, AutoSettings } from './types';
import {
  createAutoSession,
  getAutoSession,
  updateAutoSession,
  createAutoCycle,
  getAutoCycle,
  updateAutoCycle,
  getAutoCyclesBySession,
  createAutoFinding,
  getAutoFinding,
  updateAutoFinding,
  getAutoFindings,
  getOpenAutoFindings,
  getAllAutoSettings,
  initAutoTables,
  getAutoAgents,
  createAutoUserPrompt,
  getAutoUserPrompts,
  getAutoAgentRunsByCycle,
} from './db';
import { PhaseSelector } from './phase-selector';
import { PromptBuilder } from './prompt-builder';
import { FindingExtractor } from './finding-extractor';
import { GitManager } from './git-manager';
import { StateManager } from './state-manager';
import { CodebaseScanner } from './codebase-scanner';
import type {
  AutoSSEEvent,
  AutoRunStatus,
  AutoSessionStatus,
  AutoPhase,
  AutoCycleStatus,
  FailureHistoryEntry,
} from './types';
import type { SSEEvent, RateLimitInfo } from '../types';

const BACKOFF_BASE_MS = 5 * 60 * 1000; // 5 minutes
const BACKOFF_MAX_MS = 40 * 60 * 1000; // 40 minutes
const EVENT_BUFFER_SIZE = 500;
const MAX_CONSECUTIVE_FAILURES_DEFAULT = 5;

class CycleEngineImpl {
  private executor: ClaudeExecutor | null = null;
  private pipelineExecutor: PipelineExecutor | null = null;
  private currentSessionId: string | null = null;
  private currentCycleId: string | null = null;
  private cycleNumber: number = 0;
  private currentPhase: AutoPhase | null = null;
  private currentFindingId: string | null = null;
  private lastPhase: AutoPhase | null = null;
  private lastCycleStatus: AutoCycleStatus | null = null;
  private lastFindingId: string | null = null;
  private retryCount: number = 0;
  private retryTimer: NodeJS.Timeout | null = null;
  private waitingUntil: Date | null = null;
  private listeners: Set<(event: AutoSSEEvent) => void> = new Set();
  private eventBuffer: AutoSSEEvent[] = [];
  private currentOutput: string = '';
  private consecutiveFailures: number = 0;
  private isPaused: boolean = false;
  private isPauseAfterCycle: boolean = false;
  private isStopping: boolean = false;
  private codebaseSummaryCache: string | null = null;

  // SSE listener management (identical pattern to RunManager)
  addListener(listener: (event: AutoSSEEvent) => void): () => void {
    this.listeners.add(listener);
    for (const event of this.eventBuffer) {
      listener(event);
    }
    return () => this.listeners.delete(listener);
  }

  private emit(event: AutoSSEEvent): void {
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

  clearBuffer(): void {
    this.eventBuffer = [];
  }

  // --- Lifecycle ---

  async start(targetProject?: string, initialPrompt?: string): Promise<void> {
    // Guard: already running
    if (this.executor?.isRunning() || this.retryTimer || this.currentSessionId) {
      throw new Error('Autonomous mode is already running');
    }

    // Note: manual mode and auto mode can run in parallel on different projects

    // Init tables
    initAutoTables();

    // Get settings
    const settings = getAllAutoSettings();
    const rawProject = targetProject || settings.target_project;
    if (!rawProject) {
      throw new Error('Target project path is required');
    }
    const project = resolveTildePath(rawProject);

    // Create session
    const session = createAutoSession(project, undefined, initialPrompt);
    this.currentSessionId = session.id;
    this.cycleNumber = 0;
    this.consecutiveFailures = 0;
    this.isPaused = false;
    this.isStopping = false;
    this.lastPhase = null;
    this.lastCycleStatus = null;
    this.lastFindingId = null;
    this.eventBuffer = [];
    this.currentOutput = '';

    caffeinateManager.acquire();

    this.emit({
      type: 'session_status',
      data: { status: 'running', sessionId: session.id },
      timestamp: new Date().toISOString(),
    });

    // Scan codebase for SESSION-STATE.md context
    try {
      const scanner = new CodebaseScanner(project);
      const summary = await scanner.scan();
      this.codebaseSummaryCache = scanner.formatAsMarkdown(summary);
    } catch {
      this.codebaseSummaryCache = null;
    }

    // Start the cycle loop
    this.processNextCycle();
  }

  async stop(): Promise<void> {
    this.isStopping = true;

    this.pipelineExecutor?.abort();
    this.pipelineExecutor = null;

    if (this.executor) {
      this.executor.kill();
      this.executor = null;
    }

    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.waitingUntil = null;

    // Update current cycle if any
    if (this.currentCycleId) {
      updateAutoCycle(this.currentCycleId, {
        status: 'failed',
        output: this.currentOutput,
        completed_at: new Date().toISOString(),
      });
    }

    if (this.currentSessionId) {
      updateAutoSession(this.currentSessionId, { status: 'stopped' });
      this.emit({
        type: 'session_status',
        data: { status: 'stopped', sessionId: this.currentSessionId },
        timestamp: new Date().toISOString(),
      });
    }

    caffeinateManager.release();
    this.resetState();
  }

  async pause(): Promise<void> {
    if (!this.currentSessionId) {
      throw new Error('No active autonomous session');
    }

    this.isPaused = true;

    this.pipelineExecutor?.abort();
    this.pipelineExecutor = null;

    if (this.executor) {
      this.executor.kill();
      this.executor = null;
    }

    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.waitingUntil = null;

    if (this.currentCycleId) {
      updateAutoCycle(this.currentCycleId, {
        status: 'failed',
        output: this.currentOutput,
        completed_at: new Date().toISOString(),
      });
      this.currentCycleId = null;
    }

    updateAutoSession(this.currentSessionId, { status: 'paused' });
    this.emit({
      type: 'session_status',
      data: { status: 'paused', sessionId: this.currentSessionId },
      timestamp: new Date().toISOString(),
    });

    caffeinateManager.release();
  }

  async pauseAfterCycle(): Promise<void> {
    if (!this.currentSessionId) {
      throw new Error('No active autonomous session');
    }
    this.isPauseAfterCycle = true;
    this.emit({
      type: 'session_status',
      data: { status: 'pause_scheduled', sessionId: this.currentSessionId },
      timestamp: new Date().toISOString(),
    });
  }

  cancelPauseAfterCycle(): void {
    this.isPauseAfterCycle = false;
  }

  async resume(midSessionPrompt?: string): Promise<void> {
    if (!this.currentSessionId) {
      throw new Error('No active autonomous session to resume');
    }

    const session = getAutoSession(this.currentSessionId);
    if (!session || session.status !== 'paused') {
      throw new Error('Session is not paused');
    }

    this.isPaused = false;
    caffeinateManager.acquire();

    if (midSessionPrompt?.trim()) {
      createAutoUserPrompt({
        session_id: this.currentSessionId!,
        content: midSessionPrompt.trim(),
        added_at_cycle: this.cycleNumber,
      });
      this.emit({
        type: 'user_prompt_added',
        data: { content: midSessionPrompt.trim(), addedAtCycle: this.cycleNumber },
        timestamp: new Date().toISOString(),
      });
    }

    updateAutoSession(this.currentSessionId, { status: 'running' });

    this.emit({
      type: 'session_status',
      data: { status: 'running', sessionId: this.currentSessionId },
      timestamp: new Date().toISOString(),
    });

    this.processNextCycle();
  }

  emitUserPromptAdded(prompt: AutoUserPrompt): void {
    this.emit({
      type: 'user_prompt_added',
      data: { id: prompt.id, content: prompt.content, addedAtCycle: prompt.added_at_cycle },
      timestamp: new Date().toISOString(),
    });
  }

  getStatus(): AutoRunStatus {
    if (!this.currentSessionId) {
      return {
        sessionId: null,
        status: 'idle',
        currentCycle: 0,
        currentPhase: null,
        currentFinding: null,
        stats: {
          totalCycles: 0,
          totalCostUsd: 0,
          findingsTotal: 0,
          findingsResolved: 0,
          findingsOpen: 0,
          testPassRate: null,
        },
        currentAgent: null,
        pipelineAgents: [],
        waitingUntil: null,
        retryCount: 0,
        pauseAfterCycle: false,
      };
    }

    const session = getAutoSession(this.currentSessionId);
    const allFindings = getAutoFindings({ session_id: this.currentSessionId });
    const openFindings = allFindings.filter(f => f.status === 'open' || f.status === 'in_progress');
    const resolvedFindings = allFindings.filter(f => f.status === 'resolved');

    let currentFinding: { id: string; title: string } | null = null;
    if (this.currentFindingId) {
      const f = getAutoFinding(this.currentFindingId);
      if (f) currentFinding = { id: f.id, title: f.title };
    }

    let currentAgent: { id: string; name: string } | null = null;
    let pipelineAgents: Array<{ id: string; name: string; status: string }> = [];
    if (this.currentPhase === 'pipeline' as AutoPhase) {
      try {
        const enabledAgents = getAutoAgents(true);
        pipelineAgents = enabledAgents.map(a => ({
          id: a.id,
          name: a.display_name,
          status: 'pending',
        }));
        // Update with actual run statuses if cycle exists
        if (this.currentCycleId) {
          const runs = getAutoAgentRunsByCycle(this.currentCycleId);
          for (const run of runs) {
            const agentIdx = pipelineAgents.findIndex(a => a.id === run.agent_id);
            if (agentIdx >= 0) {
              pipelineAgents[agentIdx].status = run.status;
            }
          }
          const runningRun = runs.find((r: { status: string }) => r.status === 'running');
          if (runningRun) {
            currentAgent = { id: runningRun.agent_id, name: runningRun.agent_name };
          }
        }
      } catch { /* ignore */ }
    }

    return {
      sessionId: this.currentSessionId,
      status: (session?.status as AutoSessionStatus) ?? 'running',
      currentCycle: this.cycleNumber,
      currentPhase: this.currentPhase,
      currentFinding,
      stats: {
        totalCycles: session?.total_cycles ?? 0,
        totalCostUsd: session?.total_cost_usd ?? 0,
        findingsTotal: allFindings.length,
        findingsResolved: resolvedFindings.length,
        findingsOpen: openFindings.length,
        testPassRate: null, // Could compute from recent test cycles
      },
      currentAgent,
      pipelineAgents,
      waitingUntil: this.waitingUntil?.toISOString() ?? null,
      retryCount: this.retryCount,
      pauseAfterCycle: this.isPauseAfterCycle,
    };
  }

  // --- Internal cycle processing ---

  private processNextCycle(): void {
    if (this.isPaused || this.isStopping || !this.currentSessionId) return;

    // Graceful pause: stop before starting next cycle
    if (this.isPauseAfterCycle) {
      this.isPauseAfterCycle = false;
      this.isPaused = true;
      updateAutoSession(this.currentSessionId, { status: 'paused' });
      this.emit({
        type: 'session_status',
        data: { status: 'paused', reason: 'pause_after_cycle', sessionId: this.currentSessionId },
        timestamp: new Date().toISOString(),
      });
      caffeinateManager.release();
      return;
    }

    // Use setTimeout to avoid deep call stacks
    setTimeout(async () => {
      try {
        await this._processNextCycleImpl();
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        this.emit({
          type: 'error',
          data: { message },
          timestamp: new Date().toISOString(),
        });
        // Don't stop on error, try next cycle
        this.consecutiveFailures++;
        if (this.checkSafetyLimits()) {
          this.processNextCycle();
        }
      }
    }, 100); // Small delay between cycles
  }

  private isPipelineMode(): boolean {
    try {
      const enabledAgents = getAutoAgents(true);
      return enabledAgents.length > 0;
    } catch {
      return false;
    }
  }

  private async _processNextCycleImpl(): Promise<void> {
    if (!this.currentSessionId) return;

    const session = getAutoSession(this.currentSessionId);
    if (!session) return;

    if (!this.checkSafetyLimits()) return;

    if (this.isPipelineMode()) {
      await this._processNextCyclePipeline(session);
    } else {
      await this._processNextCycleV1(session);
    }
  }

  private async _processNextCycleV1(session: NonNullable<ReturnType<typeof getAutoSession>>): Promise<void> {
    const settings = getAllAutoSettings();
    const openFindings = getOpenAutoFindings();

    // Select next phase
    const phaseSelector = new PhaseSelector(settings);
    const selection = phaseSelector.selectNextPhase({
      cycleNumber: this.cycleNumber,
      lastPhase: this.lastPhase,
      lastCycleStatus: this.lastCycleStatus,
      lastFindingId: this.lastFindingId,
      openFindings,
      totalCycles: session.total_cycles,
    });

    this.currentPhase = selection.phase;
    this.currentFindingId = selection.findingId;

    // Mark finding as in_progress
    if (selection.findingId) {
      updateAutoFinding(selection.findingId, { status: 'in_progress' });
    }

    // Git checkpoint
    let gitCheckpoint: string | null = null;
    if (settings.auto_commit) {
      const gitManager = new GitManager(session.target_project);
      gitCheckpoint = await gitManager.createCheckpoint();
    }

    // Build prompt
    const promptBuilder = new PromptBuilder(settings);
    const stateManager = new StateManager(session.target_project);
    const stateContext = await stateManager.readState() || '';
    const allFindings = getAutoFindings({ session_id: this.currentSessionId! });

    let prompt: string;
    switch (selection.phase) {
      case 'discovery':
        prompt = promptBuilder.buildDiscoveryPrompt(stateContext, allFindings);
        break;
      case 'fix': {
        const fixFinding = selection.findingId ? getAutoFinding(selection.findingId) : null;
        prompt = fixFinding
          ? promptBuilder.buildFixPrompt(stateContext, fixFinding)
          : promptBuilder.buildDiscoveryPrompt(stateContext, allFindings);
        break;
      }
      case 'test':
        prompt = promptBuilder.buildTestPrompt(stateContext);
        break;
      case 'improve': {
        const improveFinding = selection.findingId ? getAutoFinding(selection.findingId) : null;
        prompt = improveFinding
          ? promptBuilder.buildImprovePrompt(stateContext, improveFinding)
          : promptBuilder.buildDiscoveryPrompt(stateContext, allFindings);
        break;
      }
      case 'review': {
        const gitMgr = new GitManager(session.target_project);
        const diff = gitCheckpoint ? await gitMgr.getDiff(gitCheckpoint) : '';
        prompt = promptBuilder.buildReviewPrompt(stateContext, diff);
        break;
      }
      default:
        prompt = promptBuilder.buildDiscoveryPrompt(stateContext, allFindings);
        break;
    }

    // Create cycle record
    const cycle = createAutoCycle({
      session_id: this.currentSessionId!,
      cycle_number: this.cycleNumber,
      phase: selection.phase,
      finding_id: selection.findingId,
      prompt_used: prompt,
      git_checkpoint: gitCheckpoint,
    });
    this.currentCycleId = cycle.id;
    this.currentOutput = '';

    // Emit cycle_start
    this.emit({
      type: 'cycle_start',
      data: {
        cycleId: cycle.id,
        cycleNumber: this.cycleNumber,
        phase: selection.phase,
        findingId: selection.findingId,
      },
      timestamp: new Date().toISOString(),
    });

    // Execute via ClaudeExecutor
    const claudeBinary = getSetting('claude_binary') || 'claude';
    this.executor = new ClaudeExecutor(
      claudeBinary,
      (event: SSEEvent) => {
        // Forward text_delta, tool_start, tool_end events
        if (event.type === 'text_delta') {
          this.currentOutput += (event.data.text as string) || '';
        }
        this.emit({
          type: event.type as AutoSSEEvent['type'],
          data: event.data,
          timestamp: event.timestamp,
        });
      },
      (info: RateLimitInfo) => {
        // Rate limit handler
        this.handleRateLimit(info);
      },
      (result: { cost_usd: number | null; duration_ms: number | null; output: string; isError: boolean }) => {
        // Completion handler
        this.handleCycleComplete(result);
      },
    );

    this.executor.execute(prompt, session.target_project);
  }

  private async _processNextCyclePipeline(session: NonNullable<ReturnType<typeof getAutoSession>>): Promise<void> {
    if (!this.currentSessionId) return;

    const settings = getAllAutoSettings();

    // Select finding to fix (same priority logic as v1)
    const openFindings = getOpenAutoFindings();
    const actionableFindings = openFindings.filter(f => f.retry_count < f.max_retries);
    // Sort by priority: P0 > P1 > P2 > P3
    actionableFindings.sort((a, b) => a.priority.localeCompare(b.priority));
    const findingToFix = actionableFindings.length > 0 ? actionableFindings[0] : null;

    if (findingToFix) {
      updateAutoFinding(findingToFix.id, { status: 'in_progress' });
      this.currentFindingId = findingToFix.id;
    }

    // Git checkpoint
    let gitCheckpoint: string | null = null;
    if (settings.auto_commit) {
      const gitManager = new GitManager(session.target_project);
      gitCheckpoint = await gitManager.createCheckpoint();
    }

    // Create cycle with phase='pipeline'
    const cycle = createAutoCycle({
      session_id: this.currentSessionId,
      cycle_number: this.cycleNumber,
      phase: 'pipeline',
      finding_id: findingToFix?.id,
      git_checkpoint: gitCheckpoint,
    });
    this.currentCycleId = cycle.id;
    this.currentPhase = 'pipeline' as AutoPhase;
    this.currentOutput = '';

    // Emit cycle_start
    this.emit({
      type: 'cycle_start',
      data: {
        cycleId: cycle.id,
        cycleNumber: this.cycleNumber,
        phase: 'pipeline',
        findingId: findingToFix?.id ?? null,
      },
      timestamp: new Date().toISOString(),
    });

    // Execute pipeline
    this.pipelineExecutor = new PipelineExecutor(
      session,
      cycle.id,
      this.cycleNumber,
      this.emit.bind(this),
      findingToFix,
    );

    const result = await this.pipelineExecutor.execute();
    this.pipelineExecutor = null;

    // Handle rate limit
    if (result.abortedByRateLimit && result.rateLimitInfo) {
      this.handleRateLimit(result.rateLimitInfo);
      return;
    }

    const now = new Date().toISOString();

    // Extract findings from Planning Moderator or Product Designer output
    const createdFindings: Array<{ priority: string; title: string; category: string }> = [];
    const designerRun = result.agentRuns.find(r =>
      r.agent_name === 'Planning Moderator' || r.agent_name === 'Product Designer'
    );
    if (designerRun?.output) {
      const extractor = new FindingExtractor();
      const existingFindings = getAutoFindings({ session_id: this.currentSessionId });
      const newFindings = extractor.extract(designerRun.output, existingFindings);
      for (const f of newFindings) {
        const created = createAutoFinding({
          session_id: this.currentSessionId,
          category: f.category,
          priority: f.priority,
          title: f.title,
          description: f.description,
          file_path: f.file_path,
        });
        createdFindings.push(created);
        this.emit({
          type: 'finding_created',
          data: { finding: created },
          timestamp: now,
        });
      }
    }

    // Handle QA failure — create finding for failed tests (no rollback in v2)
    if (result.qaResult && !result.qaResult.passed) {
      createAutoFinding({
        session_id: this.currentSessionId,
        category: 'test_failure',
        priority: 'P0',
        title: 'QA tests failed in pipeline cycle',
        description: result.qaResult.testOutput.slice(0, 2000),
      });
    }

    // Mark finding resolved on success
    if (result.success && findingToFix) {
      updateAutoFinding(findingToFix.id, {
        status: 'resolved',
        resolved_by_cycle_id: cycle.id,
      });
      this.emit({
        type: 'finding_resolved',
        data: { findingId: findingToFix.id, cycleId: cycle.id },
        timestamp: now,
      });
    } else if (!result.success && findingToFix) {
      // Increment retry count and record failure history
      const f = getAutoFinding(findingToFix.id);
      if (f) {
        const newRetryCount = f.retry_count + 1;
        // Append to failure history
        const existingHistory: FailureHistoryEntry[] = f.failure_history ? JSON.parse(f.failure_history) : [];
        existingHistory.push({
          cycle_id: cycle.id,
          approach: result.finalOutput.slice(0, 500),
          failure_reason: result.qaResult?.testOutput?.slice(0, 500) || 'Pipeline failed',
          timestamp: now,
        });
        if (newRetryCount >= f.max_retries) {
          updateAutoFinding(findingToFix.id, { status: 'wont_fix', retry_count: newRetryCount, failure_history: JSON.stringify(existingHistory) });
        } else {
          updateAutoFinding(findingToFix.id, { status: 'open', retry_count: newRetryCount, failure_history: JSON.stringify(existingHistory) });
        }
      }
    }

    // Write cycle summary doc (before git commit so it's included)
    if (result.success) {
      await this.writeCycleDoc(session.target_project, this.cycleNumber, findingToFix, result, now, createdFindings);
    }

    // Git commit on success
    if (result.success && settings.auto_commit) {
      const gitManager = new GitManager(session.target_project);
      const checkpoint = cycle.git_checkpoint;
      let commitMsg: string;
      try {
        const diff = checkpoint ? await gitManager.getDiff(checkpoint) : '';
        const claudeBinary = getSetting('claude_binary') || 'claude';
        const generated = diff
          ? await generateCommitMessage(claudeBinary, diff)
          : '';
        commitMsg = generated || buildCycleCommitMessage(this.cycleNumber, findingToFix);
      } catch {
        commitMsg = buildCycleCommitMessage(this.cycleNumber, findingToFix);
      }
      await gitManager.commitCycleResult(commitMsg);
    }

    // Run evaluation commands and score the cycle
    const evalResults = await this.runEvaluationCommands(session.target_project, settings);
    const medianCost = this.getMedianCycleCost();
    const score = scoreCycle(result, evalResults, result.agentRuns,
      result.success && !!findingToFix, createdFindings.length, medianCost, settings.review_max_iterations);

    // Update cycle record
    const cycleStatus = result.success ? 'completed' : 'failed';
    updateAutoCycle(cycle.id, {
      status: cycleStatus,
      output: result.finalOutput,
      cost_usd: result.totalCostUsd,
      duration_ms: result.totalDurationMs,
      completed_at: now,
      build_passed: score.build_passed === null ? null : (score.build_passed ? 1 : 0),
      lint_passed: score.lint_passed === null ? null : (score.lint_passed ? 1 : 0),
      composite_score: score.composite_score,
      score_breakdown: JSON.stringify(score),
    });

    // Update evaluating variant stats for agents that ran in this cycle
    if (cycleStatus === 'completed' && score.composite_score != null) {
      for (const agentRun of result.agentRuns) {
        const variants = getVariantHistory(agentRun.agent_id).filter(v => v.status === 'evaluating');
        if (variants.length > 0) {
          const variant = variants[0];
          const newCyclesEvaluated = variant.cycles_evaluated + 1;
          const prevTotal = (variant.avg_score ?? 0) * variant.cycles_evaluated;
          const newAvgScore = (prevTotal + score.composite_score) / newCyclesEvaluated;
          updatePromptVariant(variant.id, {
            cycles_evaluated: newCyclesEvaluated,
            avg_score: newAvgScore,
          });
        }
      }
    }

    // Update session totals
    updateAutoSession(this.currentSessionId, {
      total_cycles: session.total_cycles + 1,
      total_cost_usd: session.total_cost_usd + result.totalCostUsd,
    });

    // Evolution check
    if (settings.evolution_enabled &&
        this.cycleNumber > 0 &&
        this.cycleNumber % settings.evolution_interval === 0) {
      const claudeBinary = getSetting('claude_binary') || 'claude';
      await checkAndEvolve(
        this.currentSessionId, this.cycleNumber, settings, claudeBinary, this.emit.bind(this)
      );
    }

    // Track consecutive failures
    if (!result.success) {
      this.consecutiveFailures++;
    } else {
      this.consecutiveFailures = 0;
      this.retryCount = 0;
    }

    // Emit cycle event
    this.emit({
      type: result.success ? 'cycle_complete' : 'cycle_failed',
      data: {
        cycleId: cycle.id,
        cycleNumber: this.cycleNumber,
        phase: 'pipeline',
        cost_usd: result.totalCostUsd,
        duration_ms: result.totalDurationMs,
      },
      timestamp: now,
    });

    // Update state for next cycle
    this.lastPhase = 'pipeline' as AutoPhase;
    this.lastCycleStatus = cycleStatus as AutoCycleStatus;
    this.lastFindingId = findingToFix?.id ?? null;
    this.cycleNumber++;
    this.currentCycleId = null;
    this.currentFindingId = null;
    this.executor = null;

    // Write SESSION-STATE.md
    this.updateStateFile();

    // Continue
    this.processNextCycle();
  }

  private handleCycleComplete(result: { cost_usd: number | null; duration_ms: number | null; output: string; isError: boolean }): void {
    if (!this.currentSessionId || !this.currentCycleId) return;

    const session = getAutoSession(this.currentSessionId);
    if (!session) return;

    const now = new Date().toISOString();
    const settings = getAllAutoSettings();

    // Update cycle record
    const cycleStatus: AutoCycleStatus = result.isError ? 'failed' : 'completed';
    updateAutoCycle(this.currentCycleId, {
      status: cycleStatus,
      output: result.output,
      cost_usd: result.cost_usd,
      duration_ms: result.duration_ms,
      completed_at: now,
    });

    // Update session totals
    updateAutoSession(this.currentSessionId, {
      total_cycles: session.total_cycles + 1,
      total_cost_usd: session.total_cost_usd + (result.cost_usd ?? 0),
    });

    // Track consecutive failures
    if (result.isError) {
      this.consecutiveFailures++;
    } else {
      this.consecutiveFailures = 0;
      this.retryCount = 0;
    }

    // Phase-specific result handling
    if (!result.isError) {
      this.handlePhaseResult(result.output);
    } else if (this.currentFindingId) {
      // Fix/improve failed — increment retry count
      const finding = getAutoFinding(this.currentFindingId);
      if (finding) {
        const newRetryCount = finding.retry_count + 1;
        if (newRetryCount >= finding.max_retries) {
          updateAutoFinding(this.currentFindingId, { status: 'wont_fix', retry_count: newRetryCount });
          this.emit({
            type: 'finding_failed',
            data: { findingId: this.currentFindingId, reason: 'max_retries_exceeded' },
            timestamp: now,
          });
        } else {
          updateAutoFinding(this.currentFindingId, { status: 'open', retry_count: newRetryCount });
        }
      }

      // Rollback on failure if auto_commit is enabled
      if (settings.auto_commit) {
        const cycle = getAutoCycle(this.currentCycleId);
        if (cycle?.git_checkpoint) {
          const gitManager = new GitManager(session.target_project);
          gitManager.rollback(cycle.git_checkpoint).then(success => {
            if (success) {
              updateAutoCycle(this.currentCycleId!, { status: 'rolled_back' });
              this.emit({
                type: 'git_rollback',
                data: { checkpoint: cycle.git_checkpoint },
                timestamp: new Date().toISOString(),
              });
            }
          });
        }
      }
    }

    // Emit cycle_complete/cycle_failed
    this.emit({
      type: result.isError ? 'cycle_failed' : 'cycle_complete',
      data: {
        cycleId: this.currentCycleId,
        cycleNumber: this.cycleNumber,
        phase: this.currentPhase,
        cost_usd: result.cost_usd,
        duration_ms: result.duration_ms,
      },
      timestamp: now,
    });

    // Update state for next cycle
    this.lastPhase = this.currentPhase;
    this.lastCycleStatus = cycleStatus;
    this.lastFindingId = this.currentFindingId;
    this.cycleNumber++;
    this.currentCycleId = null;
    this.currentFindingId = null;
    this.executor = null;

    // Write SESSION-STATE.md
    this.updateStateFile();

    // Continue to next cycle
    this.processNextCycle();
  }

  private handlePhaseResult(output: string): void {
    if (!this.currentSessionId) return;

    switch (this.currentPhase) {
      case 'discovery':
      case 'review': {
        // Extract new findings from output
        const extractor = new FindingExtractor();
        const existingFindings = getAutoFindings({ session_id: this.currentSessionId });
        const newFindings = extractor.extract(output, existingFindings);

        for (const f of newFindings) {
          const created = createAutoFinding({
            session_id: this.currentSessionId,
            category: f.category,
            priority: f.priority,
            title: f.title,
            description: f.description,
            file_path: f.file_path,
          });
          this.emit({
            type: 'finding_created',
            data: { finding: created },
            timestamp: new Date().toISOString(),
          });
        }
        break;
      }

      case 'fix':
      case 'improve': {
        // Mark finding as resolved (will be verified by next test phase)
        if (this.currentFindingId) {
          updateAutoFinding(this.currentFindingId, {
            status: 'resolved',
            resolved_by_cycle_id: this.currentCycleId || undefined,
          });
          this.emit({
            type: 'finding_resolved',
            data: { findingId: this.currentFindingId, cycleId: this.currentCycleId },
            timestamp: new Date().toISOString(),
          });
        }
        break;
      }

      case 'test': {
        // Parse test results from output and update cycle
        // Test phase doesn't directly resolve findings, but failed tests
        // will be captured in the next cycle selection
        break;
      }
    }
  }

  private handleRateLimit(info: RateLimitInfo): void {
    if (!this.currentSessionId) return;

    // Update session status
    updateAutoSession(this.currentSessionId, { status: 'waiting_for_limit' });

    // Update cycle
    if (this.currentCycleId) {
      updateAutoCycle(this.currentCycleId, {
        status: 'rate_limited',
        output: this.currentOutput,
        completed_at: new Date().toISOString(),
      });
    }

    // Calculate backoff
    const backoffMs = info.retryAfterMs
      ? info.retryAfterMs
      : Math.min(BACKOFF_BASE_MS * Math.pow(2, this.retryCount), BACKOFF_MAX_MS);
    this.waitingUntil = new Date(Date.now() + backoffMs);

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
    this.currentCycleId = null;
  }

  private retryAfterLimit(): void {
    if (!this.currentSessionId) return;

    this.waitingUntil = null;
    this.retryTimer = null;

    const session = getAutoSession(this.currentSessionId);
    if (!session || session.status === 'stopped' || session.status === 'paused') return;

    updateAutoSession(this.currentSessionId, { status: 'running' });

    this.emit({
      type: 'session_status',
      data: { status: 'running', sessionId: this.currentSessionId },
      timestamp: new Date().toISOString(),
    });

    this.processNextCycle();
  }

  private checkSafetyLimits(): boolean {
    if (!this.currentSessionId) return false;

    const session = getAutoSession(this.currentSessionId);
    if (!session) return false;

    const settings = getAllAutoSettings();

    // Max cycles
    if (settings.max_cycles > 0 && session.total_cycles >= settings.max_cycles) {
      this.completeSession('max_cycles_reached');
      return false;
    }

    // Budget
    if (settings.budget_usd > 0 && session.total_cost_usd >= settings.budget_usd) {
      this.completeSession('budget_exceeded');
      return false;
    }

    // Consecutive failures
    const maxFailures = settings.max_consecutive_failures || MAX_CONSECUTIVE_FAILURES_DEFAULT;
    if (this.consecutiveFailures >= maxFailures) {
      updateAutoSession(this.currentSessionId, { status: 'paused' });
      this.emit({
        type: 'session_status',
        data: { status: 'paused', reason: 'consecutive_failures', sessionId: this.currentSessionId },
        timestamp: new Date().toISOString(),
      });
      this.isPaused = true;
      caffeinateManager.release();
      return false;
    }

    return true;
  }

  private async runEvaluationCommands(projectPath: string, settings: AutoSettings): Promise<{ build?: CommandResult; lint?: CommandResult }> {
    const results: { build?: CommandResult; lint?: CommandResult } = {};
    if (settings.build_command) {
      const buildResult = await runCommand(settings.build_command, projectPath);
      if (buildResult) results.build = buildResult;
    }
    if (settings.lint_command) {
      const lintResult = await runCommand(settings.lint_command, projectPath);
      if (lintResult) results.lint = lintResult;
    }
    return results;
  }

  private getMedianCycleCost(): number {
    if (!this.currentSessionId) return 0;
    const cycles = getAutoCyclesBySession(this.currentSessionId);
    const costs = cycles
      .filter(c => c.status === 'completed' && c.cost_usd != null && c.cost_usd > 0)
      .map(c => c.cost_usd!)
      .sort((a, b) => a - b);
    if (costs.length === 0) return 0;
    const mid = Math.floor(costs.length / 2);
    return costs.length % 2 === 0 ? (costs[mid - 1] + costs[mid]) / 2 : costs[mid];
  }

  private completeSession(reason: string): void {
    if (!this.currentSessionId) return;

    updateAutoSession(this.currentSessionId, { status: 'completed' });
    this.emit({
      type: 'session_status',
      data: { status: 'completed', reason, sessionId: this.currentSessionId },
      timestamp: new Date().toISOString(),
    });

    caffeinateManager.release();
    this.updateStateFile();
    this.resetState();
  }

  private resetState(): void {
    this.currentSessionId = null;
    this.currentCycleId = null;
    this.currentPhase = null;
    this.currentFindingId = null;
    this.cycleNumber = 0;
    this.consecutiveFailures = 0;
    this.isPaused = false;
    this.isPauseAfterCycle = false;
    this.isStopping = false;
    this.retryCount = 0;
    this.codebaseSummaryCache = null;
  }

  private async writeCycleDoc(
    targetProject: string,
    cycleNumber: number,
    finding: { priority: string; title: string; category: string } | null,
    result: PipelineResult,
    timestamp: string,
    createdFindings?: Array<{ priority: string; title: string; category: string }>,
  ): Promise<void> {
    try {
      const resolvedPath = resolveTildePath(targetProject);
      const date = timestamp.slice(0, 10);  // "2026-03-02"
      const time = timestamp.slice(11, 19).replace(/:/g, '');  // "040707"
      const docDir = path.join(resolvedPath, 'docs', 'cycle', date);
      await fs.mkdir(docDir, { recursive: true });

      // Summarize agent outputs using one-shot Claude sessions
      let agentSummaries: Map<string, string> | undefined;
      try {
        const claudeBinary = getSetting('claude_binary') || 'claude';
        agentSummaries = await summarizeAgentOutputs(claudeBinary, result.agentRuns);
      } catch {
        // Fall back to truncated output if summarization fails
      }

      const doc = buildCycleDoc(cycleNumber, finding, result, timestamp, agentSummaries, createdFindings);
      await fs.writeFile(path.join(docDir, `cycle-${cycleNumber}-${time}.md`), doc, 'utf-8');
    } catch {
      // Don't fail the cycle if doc writing fails
    }
  }

  private async updateStateFile(): Promise<void> {
    if (!this.currentSessionId) return;
    try {
      const session = getAutoSession(this.currentSessionId);
      if (!session) return;
      const cycles = getAutoCyclesBySession(this.currentSessionId);
      const findings = getAutoFindings({ session_id: this.currentSessionId });
      const stateManager = new StateManager(session.target_project);
      await stateManager.writeState(session, cycles, findings, this.codebaseSummaryCache ?? undefined);
    } catch {
      // Don't fail the cycle if state file write fails
    }
  }
}

// --- Exported helpers (also used by tests) ---

export function buildCycleCommitMessage(
  cycleNumber: number,
  finding: { priority: string; title: string } | null,
): string {
  // Title line
  const title = finding
    ? `fix: ${finding.title}`
    : `chore: autonomous cycle ${cycleNumber} changes`;

  // Body lines
  const lines: string[] = [title];

  if (finding) {
    lines.push('', `Finding: ${finding.priority} - ${finding.title}`);
  }

  return lines.join('\n');
}

export function parseQACounts(testOutput: string): { passed: number | null; failed: number | null; total: number | null } {
  // Try JSON summary format first (QA agent outputs structured JSON)
  // Iterate over balanced {...} candidates to avoid greedy over-matching
  const braceMatches = testOutput.matchAll(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g);
  for (const m of braceMatches) {
    try {
      const parsed = JSON.parse(m[0]);
      if (parsed.summary && typeof parsed.summary === 'object') {
        const s = parsed.summary;
        return {
          passed: typeof s.passed === 'number' ? s.passed : null,
          failed: typeof s.failed === 'number' ? s.failed : null,
          total: typeof s.total === 'number' ? s.total : null,
        };
      }
    } catch { continue; }
  }

  // Regex fallback for text-based test output
  const passedMatch = testOutput.match(/(\d+)\s*passed/i);
  const failedMatch = testOutput.match(/(\d+)\s*failed/i);
  const totalMatch = testOutput.match(/(\d+)\s*total/i);

  return {
    passed: passedMatch ? parseInt(passedMatch[1], 10) : null,
    failed: failedMatch ? parseInt(failedMatch[1], 10) : null,
    total: totalMatch ? parseInt(totalMatch[1], 10) : null,
  };
}

export function buildCycleDoc(
  cycleNumber: number,
  finding: { priority: string; title: string; category: string } | null,
  result: PipelineResult,
  timestamp: string,
  agentSummaries?: Map<string, string>,
  createdFindings?: Array<{ priority: string; title: string; category: string }>,
): string {
  const durationMin = (result.totalDurationMs / 60000).toFixed(1);
  const cost = result.totalCostUsd.toFixed(2);

  // Determine which finding to display
  let displayFinding: { priority: string; title: string; category: string } | null = null;
  let isDiscovery = false;
  if (finding) {
    displayFinding = finding;
  } else if (createdFindings && createdFindings.length > 0) {
    displayFinding = createdFindings[0];
    isDiscovery = true;
  }

  const lines: string[] = [
    `# Cycle ${cycleNumber} Summary`,
    '',
    `- **Date**: ${timestamp}`,
    '- **Status**: completed',
    `- **Cost**: $${cost}`,
    `- **Duration**: ${durationMin}min`,
    '',
    '## Finding',
    '',
    `- **Priority**: ${displayFinding?.priority ?? 'N/A'}`,
    `- **Title**: ${displayFinding?.title ?? 'N/A'}`,
    `- **Category**: ${displayFinding?.category ?? 'N/A'}`,
  ];

  if (isDiscovery) {
    lines.push('- **Note**: Discovery (newly created finding)');
  }

  lines.push('', '## Agent Results', '');

  const agentNames = ['UX Planner', 'Tech Planner', 'Biz Planner', 'Planning Moderator', 'Product Designer', 'Developer', 'Reviewer', 'QA Engineer'];
  const runsByName = new Map(result.agentRuns.map(r => [r.agent_name, r]));

  for (const name of agentNames) {
    const run = runsByName.get(name);
    lines.push(`### ${name}`);
    if (!run || run.status === 'skipped' || !run.output) {
      lines.push('skipped');
    } else {
      const summary = agentSummaries?.get(name);
      if (summary) {
        lines.push(summary);
      } else {
        const output = run.output.length > 500 ? run.output.slice(0, 500) + '...' : run.output;
        lines.push(output);
      }
    }
    lines.push('');
  }

  // Also include any agents not in the standard list
  for (const run of result.agentRuns) {
    if (!agentNames.includes(run.agent_name)) {
      lines.push(`### ${run.agent_name}`);
      if (run.status === 'skipped' || !run.output) {
        lines.push('skipped');
      } else {
        const summary = agentSummaries?.get(run.agent_name);
        if (summary) {
          lines.push(summary);
        } else {
          const output = run.output.length > 500 ? run.output.slice(0, 500) + '...' : run.output;
          lines.push(output);
        }
      }
      lines.push('');
    }
  }

  lines.push('## QA Results');
  if (result.qaResult) {
    const counts = parseQACounts(result.qaResult.testOutput);
    lines.push(`- Passed: ${counts.passed ?? 'N/A'}`);
    lines.push(`- Failed: ${counts.failed ?? 'N/A'}`);
    lines.push(`- Total: ${counts.total ?? 'N/A'}`);
  } else {
    lines.push('- Passed: N/A');
    lines.push('- Failed: N/A');
    lines.push('- Total: N/A');
  }
  lines.push('');

  return lines.join('\n');
}

// --- Exported utility ---

export function resolveTildePath(p: string): string {
  return p.startsWith('~')
    ? path.join(os.homedir(), p.slice(1))
    : p;
}

// Global singleton (HMR-safe: patch prototype so new methods are available on cached instance)
const globalForAutoEngine = globalThis as unknown as { autoEngine: CycleEngineImpl };
if (!globalForAutoEngine.autoEngine) {
  globalForAutoEngine.autoEngine = new CycleEngineImpl();
} else {
  Object.setPrototypeOf(globalForAutoEngine.autoEngine, CycleEngineImpl.prototype);
}
export const autoEngine = globalForAutoEngine.autoEngine;
