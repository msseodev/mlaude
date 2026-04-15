import { spawn } from 'child_process';
import { PipelineExecutor } from './pipeline-executor';
import type { PipelineResult } from './pipeline-executor';
import { GitManager } from './git-manager';
import { getSetting } from '../db';
import {
  createAutoCycle,
  updateAutoCycle,
  updateAutoFinding,
  pickAndClaimNextFinding,
  getAutoSession,
  updateAutoSession,
} from './db';
import type { AutoSession, AutoFinding, AutoSSEEvent, PipelineType } from './types';
import path from 'path';
import fs from 'fs/promises';

interface WorkerState {
  active: boolean;
  findingId: string | null;
  cycleId: string | null;
}

export class WorkerPool {
  private workers: Map<number, WorkerState> = new Map();
  private stopped = false;
  public abortedByAuthError = false;
  private activePromises: Map<number, Promise<void>> = new Map();
  private activeExecutors: Map<number, PipelineExecutor> = new Map();
  private mergeLock: Promise<void> = Promise.resolve();
  private worktreePool: Map<number, { path: string; branch: string }> = new Map();
  private poolDestroyed = false;
  private _completedCycles: number = 0;
  private _failedCycles: number = 0;
  /** Highest cycle_number that this pool has created (DB-assigned) */
  private _maxCycleNumberCreated: number = -1;
  /** true if the last cycle in the batch (by cycle_number) succeeded */
  private _lastCycleSucceeded: boolean = false;
  private _lastCompletedCycleNumber: number = -1;

  constructor(
    private session: AutoSession,
    private emit: (event: AutoSSEEvent) => void,
    private maxWorkers: number,
  ) {}

  async start(): Promise<void> {
    this.emit({
      type: 'parallel_batch_start',
      data: { workerCount: this.maxWorkers },
      timestamp: new Date().toISOString(),
    });

    // Create fixed worktree pool
    try {
      await this.initWorktreePool();
    } catch (err) {
      await this.destroyWorktreePool();
      throw err;
    }

    // Launch N workers
    for (let i = 0; i < this.maxWorkers; i++) {
      this.workers.set(i, { active: false, findingId: null, cycleId: null });
      this.activePromises.set(i, this.runWorker(i));
    }
    // Wait for all workers to finish (they stop when no more findings)
    await Promise.allSettled([...this.activePromises.values()]);

    // Destroy worktree pool
    await this.destroyWorktreePool();

    this.emit({
      type: 'parallel_batch_complete',
      data: { totalCycles: this._maxCycleNumberCreated + 1 },
      timestamp: new Date().toISOString(),
    });
  }

  stop(): void {
    this.stopped = true;
    for (const [, executor] of this.activeExecutors) {
      executor.abort();
    }
    this.activeExecutors.clear();
    // Pool cleanup happens asynchronously after workers exit in start()
    // but we also schedule it here for immediate cleanup on force stop
    this.destroyWorktreePool().catch(() => { /* best-effort */ });
  }

  getStatus(): { workers: Array<{ id: number; active: boolean; findingId: string | null; cycleId: string | null }> } {
    return {
      workers: [...this.workers.entries()].map(([id, w]) => ({ id, ...w })),
    };
  }

  /** Returns a cycle-number cursor for the engine to stay in sync (last created + 1). */
  getCycleCount(): number {
    return this._maxCycleNumberCreated + 1;
  }

  /** Number of cycles that completed successfully in this batch */
  get completedCycles(): number { return this._completedCycles; }
  /** Number of cycles that failed in this batch */
  get failedCycles(): number { return this._failedCycles; }
  /** Whether the last finished cycle (by cycle_number) succeeded — used for consecutive failure tracking */
  get lastCycleSucceeded(): boolean { return this._lastCycleSucceeded; }
  /** Count of consecutive failures at the tail of this batch */
  get trailingFailureCount(): number { return this._trailingFailures; }
  private _trailingFailures: number = 0;

  private async runWorker(workerId: number): Promise<void> {
    const wt = this.worktreePool.get(workerId);
    if (!wt) return;

    while (!this.stopped) {
      // 1. Pick next actionable finding
      const finding = this.pickNextFinding();
      if (!finding) break;

      this.workers.set(workerId, { active: true, findingId: finding.id, cycleId: null });

      // 2. Reset worktree to current main HEAD
      const gitManager = new GitManager(this.session.target_project);
      const resetOk = await gitManager.resetWorktree(wt.path);
      if (!resetOk) {
        updateAutoFinding(finding.id, { status: 'open' });
        this.workers.set(workerId, { active: false, findingId: null, cycleId: null });
        continue;
      }

      // 3. Create cycle record — cycle_number is assigned atomically by the DB
      //    (transactional MAX+1), guaranteeing uniqueness across concurrent
      //    workers and overlapping WorkerPool lifetimes.
      const cycle = createAutoCycle({
        session_id: this.session.id,
        phase: 'pipeline',
        finding_id: finding.id,
      });
      const cycleNumber = cycle.cycle_number;
      if (cycleNumber > this._maxCycleNumberCreated) {
        this._maxCycleNumberCreated = cycleNumber;
      }
      this.workers.set(workerId, { active: true, findingId: finding.id, cycleId: cycle.id });

      // 5. Emit cycle_start
      const pipelineType: PipelineType = finding.category === 'test_failure' ? 'test_fix' : 'fix';
      const cycleEmit = (event: AutoSSEEvent): void => {
        this.emit({ ...event, data: { ...event.data, cycleId: cycle.id, workerId } });
      };
      cycleEmit({
        type: 'cycle_start',
        data: {
          cycleId: cycle.id,
          cycleNumber,
          phase: 'pipeline',
          findingId: finding.id,
          findingTitle: finding.title,
          pipelineType,
          parallel: true,
        },
        timestamp: new Date().toISOString(),
      });

      // 6. Run pipeline
      const worktreeSession = { ...this.session, target_project: wt.path };
      const executor = new PipelineExecutor(
        worktreeSession,
        cycle.id,
        cycleNumber,
        cycleEmit,
        finding,
        pipelineType,
      );

      this.activeExecutors.set(workerId, executor);
      let pipelineResult: PipelineResult | null = null;
      try {
        pipelineResult = await executor.execute();
        cycleEmit({
          type: pipelineResult.success ? 'cycle_complete' : 'cycle_failed',
          data: {
            cycleId: cycle.id,
            cycleNumber,
            phase: 'pipeline',
            cost_usd: pipelineResult.totalCostUsd,
            duration_ms: pipelineResult.totalDurationMs,
            parallel: true,
          },
          timestamp: new Date().toISOString(),
        });
      } catch {
        cycleEmit({
          type: 'cycle_failed',
          data: { cycleId: cycle.id, cycleNumber, phase: 'pipeline', parallel: true },
          timestamp: new Date().toISOString(),
        });
      } finally {
        this.activeExecutors.delete(workerId);
      }

      // 7. Handle result
      const cycleSucceeded = !!pipelineResult?.success;
      if (cycleSucceeded) {
        this._completedCycles++;
        updateAutoCycle(cycle.id, {
          status: 'completed',
          output: pipelineResult!.finalOutput,
          cost_usd: pipelineResult!.totalCostUsd,
          duration_ms: pipelineResult!.totalDurationMs,
          completed_at: new Date().toISOString(),
        });

        // Commit in worktree
        const worktreeGit = new GitManager(wt.path);
        await worktreeGit.commitAll(`fix: ${finding.title}`);

        // Merge
        await this.mergeWithLock(gitManager, wt.branch, finding, cycle.id);
      } else {
        this._failedCycles++;
        updateAutoCycle(cycle.id, {
          status: 'failed',
          completed_at: new Date().toISOString(),
        });
        const newRetry = finding.retry_count + 1;
        updateAutoFinding(finding.id, {
          status: newRetry >= finding.max_retries ? 'wont_fix' : 'open',
          retry_count: newRetry,
        });
      }

      // Track trailing failures
      if (cycleNumber > this._lastCompletedCycleNumber) {
        this._lastCompletedCycleNumber = cycleNumber;
        this._lastCycleSucceeded = cycleSucceeded;
      }
      if (cycleSucceeded) {
        this._trailingFailures = 0;
      } else {
        this._trailingFailures++;
      }

      // 8. Update session totals
      if (pipelineResult) {
        const currentSession = getAutoSession(this.session.id);
        if (currentSession) {
          updateAutoSession(this.session.id, {
            total_cycles: currentSession.total_cycles + 1,
            total_cost_usd: currentSession.total_cost_usd + (pipelineResult.totalCostUsd ?? 0),
          });
        }
      }

      // 9. Rate limit check (no worktree cleanup needed -- pool handles it)
      if (pipelineResult?.abortedByRateLimit) {
        this.stopped = true;
        break;
      }

      // 10. Auth error check
      if (pipelineResult?.abortedByAuthError) {
        this.stopped = true;
        this.abortedByAuthError = true;
        updateAutoFinding(finding.id, { status: 'open' });
        break;
      }

      this.workers.set(workerId, { active: false, findingId: null, cycleId: null });
    }

    this.workers.set(workerId, { active: false, findingId: null, cycleId: null });
  }

  private async initWorktreePool(): Promise<void> {
    this.poolDestroyed = false;
    const gitManager = new GitManager(this.session.target_project);
    const baseDir = path.join(this.session.target_project, '.mlaude', 'worktrees');
    await fs.mkdir(baseDir, { recursive: true });

    for (let i = 0; i < this.maxWorkers; i++) {
      const worktreePath = path.join(baseDir, `w${i}`);
      const branchName = `auto/worker-${i}`;

      // Clean up any leftover from previous run
      await gitManager.removeWorktree(worktreePath);
      await gitManager.deleteBranch(branchName);
      try { await fs.rm(worktreePath, { recursive: true }); } catch { /* ignore */ }

      const ok = await gitManager.createWorktree(branchName, worktreePath);
      if (!ok) throw new Error(`Failed to create worktree for worker ${i}`);

      await this.symlinkDependencies(this.session.target_project, worktreePath);
      this.worktreePool.set(i, { path: worktreePath, branch: branchName });
    }
  }

  private async destroyWorktreePool(): Promise<void> {
    if (this.poolDestroyed) return;
    this.poolDestroyed = true;
    const gitManager = new GitManager(this.session.target_project);
    for (const [, { path: wPath, branch }] of this.worktreePool) {
      await gitManager.removeWorktree(wPath);
      await gitManager.deleteBranch(branch);
      try { await fs.rm(wPath, { recursive: true }); } catch { /* ignore */ }
    }
    this.worktreePool.clear();
  }

  /**
   * Thread-safe finding picker.
   * Uses a SQLite transaction to atomically select and claim the next finding,
   * preventing multiple workers from picking the same finding.
   */
  private pickNextFinding(): AutoFinding | null {
    return pickAndClaimNextFinding();
  }

  /**
   * Merge lock to prevent concurrent git merge operations.
   * Chains merge operations sequentially using a promise chain so
   * only one worker merges at a time.
   */
  private async mergeWithLock(
    gitManager: GitManager,
    branchName: string,
    finding: AutoFinding,
    cycleId: string,
  ): Promise<void> {
    this.mergeLock = this.mergeLock.then(async () => {
      const mergeResult = await gitManager.mergeWorktreeBranch(branchName);
      let merged = mergeResult.success;
      const conflicted = mergeResult.conflicted;

      if (!merged && conflicted) {
        const resolved = await this.resolveConflictsWithClaude(gitManager, { finding, branchName });
        if (resolved) {
          merged = true;
        } else {
          await gitManager.abortMerge();
        }
      }

      if (merged) {
        updateAutoFinding(finding.id, {
          status: 'resolved',
          resolved_by_cycle_id: cycleId,
        });
        this.emit({
          type: 'finding_resolved',
          data: { findingId: finding.id, cycleId },
          timestamp: new Date().toISOString(),
        });
      } else {
        const newRetry = finding.retry_count + 1;
        updateAutoFinding(finding.id, {
          status: newRetry >= finding.max_retries ? 'wont_fix' : 'open',
          retry_count: newRetry,
        });
      }
    });
    await this.mergeLock;
  }

  private async resolveConflictsWithClaude(
    gitManager: GitManager,
    task: { finding: AutoFinding; branchName: string },
  ): Promise<boolean> {
    try {
      const conflictedFiles = await gitManager.getConflictedFiles();
      if (conflictedFiles.length === 0) return false;

      const prompt = [
        'Resolve the following git merge conflicts.',
        'The conflict markers (<<<<<<< HEAD, =======, >>>>>>>) are in the files listed below.',
        'Edit each file to resolve the conflicts by keeping the correct combined result.',
        `Context: merging branch "${task.branchName}" which implements "${task.finding.title}".`,
        '',
        'Conflicted files:',
        ...conflictedFiles.map(f => `- ${f}`),
        '',
        'After resolving all conflicts, run: git add -A',
      ].join('\n');

      const claudeBinary = getSetting('claude_binary') || 'claude';
      const exitCode = await new Promise<number | null>((resolve, reject) => {
        const proc = spawn(claudeBinary, ['--print', '--dangerously-skip-permissions'], {
          cwd: this.session.target_project,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        proc.stdin?.write(prompt);
        proc.stdin?.end();

        const timeout = setTimeout(() => {
          proc.kill('SIGTERM');
          reject(new Error('Conflict resolution timed out after 60s'));
        }, 60_000);

        proc.on('close', (code) => {
          clearTimeout(timeout);
          resolve(code);
        });
        proc.on('error', (err) => {
          clearTimeout(timeout);
          reject(err);
        });
      });

      if (exitCode !== 0) return false;

      // Complete the merge
      return await gitManager.completeMerge(`merge: resolve conflicts for ${task.finding.title}`);
    } catch (err) {
      console.warn('[parallel] Conflict resolution failed:', err);
      return false;
    }
  }

  private async symlinkDependencies(mainDir: string, worktreeDir: string): Promise<void> {
    // Symlink common dependency directories to avoid re-installation
    const dirs = ['node_modules', '.dart_tool', 'build', '.flutter-plugins', '.flutter-plugins-dependencies'];
    for (const dir of dirs) {
      const src = path.join(mainDir, dir);
      const dst = path.join(worktreeDir, dir);
      try {
        const stat = await fs.stat(src);
        if (stat.isDirectory()) {
          await fs.symlink(src, dst, 'dir');
        }
      } catch { /* source doesn't exist, skip */ }
    }
  }
}
