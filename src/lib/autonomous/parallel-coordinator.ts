import { spawnSync } from 'child_process';
import { PipelineExecutor } from './pipeline-executor';
import type { PipelineResult } from './pipeline-executor';
import { GitManager } from './git-manager';
import { getSetting } from '../db';
import {
  createAutoCycle,
  updateAutoCycle,
  updateAutoFinding,
  getOpenAutoFindings,
  getAutoSession,
  updateAutoSession,
} from './db';
import type { AutoSession, AutoFinding, AutoSSEEvent, PipelineType } from './types';
import { v4 as uuidv4 } from 'uuid';
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
  private cycleCounter: number;
  private activePromises: Map<number, Promise<void>> = new Map();
  private mergeLock: Promise<void> = Promise.resolve();

  constructor(
    private session: AutoSession,
    private emit: (event: AutoSSEEvent) => void,
    private maxWorkers: number,
    startCycleNumber: number,
  ) {
    this.cycleCounter = startCycleNumber;
  }

  async start(): Promise<void> {
    this.emit({
      type: 'parallel_batch_start',
      data: { workerCount: this.maxWorkers },
      timestamp: new Date().toISOString(),
    });

    // Launch N workers
    for (let i = 0; i < this.maxWorkers; i++) {
      this.workers.set(i, { active: false, findingId: null, cycleId: null });
      this.activePromises.set(i, this.runWorker(i));
    }
    // Wait for all workers to finish (they stop when no more findings)
    await Promise.allSettled([...this.activePromises.values()]);

    this.emit({
      type: 'parallel_batch_complete',
      data: { totalCycles: this.cycleCounter },
      timestamp: new Date().toISOString(),
    });
  }

  stop(): void {
    this.stopped = true;
  }

  getStatus(): { workers: Array<{ id: number; active: boolean; findingId: string | null; cycleId: string | null }> } {
    return {
      workers: [...this.workers.entries()].map(([id, w]) => ({ id, ...w })),
    };
  }

  getCycleCount(): number {
    return this.cycleCounter;
  }

  private async runWorker(workerId: number): Promise<void> {
    while (!this.stopped) {
      // 1. Pick next actionable finding
      const finding = this.pickNextFinding();
      if (!finding) break; // No more findings, worker exits

      this.workers.set(workerId, { active: true, findingId: finding.id, cycleId: null });

      // 2. Assign cycle number (atomic increment)
      const cycleNumber = this.cycleCounter++;

      // 3. Create worktree
      const gitManager = new GitManager(this.session.target_project);
      const batchId = uuidv4().slice(0, 8);
      const branchName = `auto/worker-${workerId}-${batchId}`;
      const worktreePath = path.join(this.session.target_project, '.mclaude', 'worktrees', `w${workerId}-${batchId}`);

      await fs.mkdir(path.dirname(worktreePath), { recursive: true });
      const ok = await gitManager.createWorktree(branchName, worktreePath);
      if (!ok) {
        updateAutoFinding(finding.id, { status: 'open' });
        this.workers.set(workerId, { active: false, findingId: null, cycleId: null });
        continue;
      }
      await this.symlinkDependencies(this.session.target_project, worktreePath);

      // 4. Create cycle record
      const cycle = createAutoCycle({
        session_id: this.session.id,
        cycle_number: cycleNumber,
        phase: 'pipeline',
        finding_id: finding.id,
      });
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
      const worktreeSession = { ...this.session, target_project: worktreePath };
      const executor = new PipelineExecutor(
        worktreeSession,
        cycle.id,
        cycleNumber,
        cycleEmit,
        finding,
        pipelineType,
      );

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
      }

      // 7. Handle result
      if (pipelineResult?.success) {
        updateAutoCycle(cycle.id, {
          status: 'completed',
          output: pipelineResult.finalOutput,
          cost_usd: pipelineResult.totalCostUsd,
          duration_ms: pipelineResult.totalDurationMs,
          completed_at: new Date().toISOString(),
        });

        // Commit in worktree
        const worktreeGit = new GitManager(worktreePath);
        await worktreeGit.commitAll(`fix: ${finding.title}`);

        // Merge (sequential -- only one worker merges at a time using a lock)
        await this.mergeWithLock(gitManager, branchName, finding, cycle.id);
      } else {
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

      // 9. Cleanup worktree
      await gitManager.removeWorktree(worktreePath);
      await gitManager.deleteBranch(branchName);
      try { await fs.rm(worktreePath, { recursive: true }); } catch { /* ignore */ }

      // 10. Rate limit check
      if (pipelineResult?.abortedByRateLimit) {
        this.stopped = true;
        break;
      }

      this.workers.set(workerId, { active: false, findingId: null, cycleId: null });
    }

    this.workers.set(workerId, { active: false, findingId: null, cycleId: null });
  }

  /**
   * Thread-safe finding picker.
   * SQLite operations are synchronous in better-sqlite3, so marking as
   * in_progress is atomic within a single Node.js tick.
   */
  private pickNextFinding(): AutoFinding | null {
    const openFindings = getOpenAutoFindings();
    const actionable = openFindings.filter(f => f.retry_count < f.max_retries && f.status === 'open');
    actionable.sort((a, b) => a.priority.localeCompare(b.priority));
    const finding = actionable[0] ?? null;
    if (finding) {
      updateAutoFinding(finding.id, { status: 'in_progress' });
    }
    return finding;
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
      const result = spawnSync(claudeBinary, ['--print', '--dangerously-skip-permissions'], {
        input: prompt,
        cwd: this.session.target_project,
        encoding: 'utf-8',
        timeout: 120_000,
      });

      if (result.status !== 0) return false;

      // Complete the merge
      return await gitManager.completeMerge(`merge: resolve conflicts for ${task.finding.title}`);
    } catch {
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
