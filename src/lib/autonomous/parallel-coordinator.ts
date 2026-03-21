import { PipelineExecutor } from './pipeline-executor';
import type { PipelineResult } from './pipeline-executor';
import { GitManager } from './git-manager';
import { createAutoCycle, updateAutoCycle, updateAutoFinding } from './db';
import type { AutoSession, AutoFinding, AutoSSEEvent, PipelineType } from './types';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs/promises';

interface ParallelCycleResult {
  cycleId: string;
  findingId: string;
  pipelineResult: PipelineResult | null;
  branchName: string;
  worktreePath: string;
  merged: boolean;
  conflicted: boolean;
}

export interface ParallelBatchResult {
  batchId: string;
  results: ParallelCycleResult[];
  totalCostUsd: number;
  totalDurationMs: number;
  abortedByRateLimit: boolean;
}

export class ParallelCycleCoordinator {
  constructor(
    private session: AutoSession,
    private emit: (event: AutoSSEEvent) => void,
  ) {}

  async executeBatch(
    findings: AutoFinding[],
    cycleNumberBase: number,
  ): Promise<ParallelBatchResult> {
    const batchId = uuidv4().slice(0, 8);
    const gitManager = new GitManager(this.session.target_project);
    const worktreeBase = path.join(this.session.target_project, '.mclaude', 'worktrees', batchId);
    await fs.mkdir(worktreeBase, { recursive: true });

    const now = new Date().toISOString();
    this.emit({
      type: 'parallel_batch_start',
      data: { batchId, findingCount: findings.length },
      timestamp: now,
    });

    // 1. Create worktrees and cycle records
    const tasks: Array<{
      finding: AutoFinding;
      cycleNumber: number;
      cycleId: string;
      branchName: string;
      worktreePath: string;
    }> = [];

    for (let i = 0; i < findings.length; i++) {
      const finding = findings[i];
      const cycleNumber = cycleNumberBase + i;
      const branchName = `auto/parallel-${batchId}-${finding.id.slice(0, 8)}`;
      const worktreePath = path.join(worktreeBase, finding.id.slice(0, 8));

      const ok = await gitManager.createWorktree(branchName, worktreePath);
      if (!ok) continue;

      // Symlink node_modules, build directories if they exist
      await this.symlinkDependencies(this.session.target_project, worktreePath);

      const cycle = createAutoCycle({
        session_id: this.session.id,
        cycle_number: cycleNumber,
        phase: 'pipeline',
        finding_id: finding.id,
      });

      updateAutoFinding(finding.id, { status: 'in_progress' });

      tasks.push({ finding, cycleNumber, cycleId: cycle.id, branchName, worktreePath });
    }

    // 2. Execute pipelines in parallel
    const pipelinePromises = tasks.map(async (task) => {
      const pipelineType: PipelineType = task.finding.category === 'test_failure' ? 'test_fix' : 'fix';

      // Create a modified session with worktree path as target_project
      const worktreeSession = { ...this.session, target_project: task.worktreePath };

      const executor = new PipelineExecutor(
        worktreeSession,
        task.cycleId,
        task.cycleNumber,
        this.emit,
        task.finding,
        pipelineType,
      );

      try {
        const result = await executor.execute();
        return { task, result };
      } catch {
        return { task, result: null as PipelineResult | null };
      }
    });

    const settled = await Promise.allSettled(pipelinePromises);

    // 3. Process results and merge
    const results: ParallelCycleResult[] = [];
    let totalCostUsd = 0;
    let totalDurationMs = 0;
    let abortedByRateLimit = false;

    // First pass: collect results
    const completedTasks: Array<{ task: typeof tasks[0]; result: PipelineResult }> = [];
    for (let idx = 0; idx < settled.length; idx++) {
      const outcome = settled[idx];
      if (outcome.status === 'fulfilled' && outcome.value.result) {
        const { task, result } = outcome.value;
        totalCostUsd += result.totalCostUsd;
        totalDurationMs += result.totalDurationMs;

        if (result.abortedByRateLimit) abortedByRateLimit = true;

        updateAutoCycle(task.cycleId, {
          status: result.success ? 'completed' : 'failed',
          output: result.finalOutput,
          cost_usd: result.totalCostUsd,
          duration_ms: result.totalDurationMs,
          completed_at: new Date().toISOString(),
        });

        if (result.success) {
          completedTasks.push({ task, result });
        } else {
          // Failed pipeline - increment retry
          const f = task.finding;
          const newRetry = f.retry_count + 1;
          updateAutoFinding(f.id, {
            status: newRetry >= f.max_retries ? 'wont_fix' : 'open',
            retry_count: newRetry,
          });
          results.push({
            cycleId: task.cycleId,
            findingId: f.id,
            pipelineResult: result,
            branchName: task.branchName,
            worktreePath: task.worktreePath,
            merged: false,
            conflicted: false,
          });
        }
      } else {
        // Promise rejected or null result
        const task = outcome.status === 'fulfilled' ? outcome.value.task : tasks[idx];
        if (task) {
          updateAutoCycle(task.cycleId, {
            status: 'failed',
            completed_at: new Date().toISOString(),
          });
          updateAutoFinding(task.finding.id, { status: 'open' });
          results.push({
            cycleId: task.cycleId,
            findingId: task.finding.id,
            pipelineResult: null,
            branchName: task.branchName,
            worktreePath: task.worktreePath,
            merged: false,
            conflicted: false,
          });
        }
      }
    }

    // 4. Sequential merge of successful branches
    for (const { task, result } of completedTasks) {
      // First, commit changes in the worktree
      const worktreeGit = new GitManager(task.worktreePath);
      await worktreeGit.commitAll(`fix: ${task.finding.title}`);

      // Then merge from main repo
      const mergeResult = await gitManager.mergeWorktreeBranch(task.branchName);

      if (mergeResult.success) {
        updateAutoFinding(task.finding.id, {
          status: 'resolved',
          resolved_by_cycle_id: task.cycleId,
        });
        this.emit({
          type: 'finding_resolved',
          data: { findingId: task.finding.id, cycleId: task.cycleId },
          timestamp: new Date().toISOString(),
        });
      } else {
        // Merge conflict - mark for serial retry
        const f = task.finding;
        const newRetry = f.retry_count + 1;
        updateAutoFinding(f.id, {
          status: newRetry >= f.max_retries ? 'wont_fix' : 'open',
          retry_count: newRetry,
        });
      }

      results.push({
        cycleId: task.cycleId,
        findingId: task.finding.id,
        pipelineResult: result,
        branchName: task.branchName,
        worktreePath: task.worktreePath,
        merged: mergeResult.success,
        conflicted: mergeResult.conflicted,
      });
    }

    // 5. Cleanup worktrees
    for (const task of tasks) {
      await gitManager.removeWorktree(task.worktreePath);
      await gitManager.deleteBranch(task.branchName);
    }
    // Remove batch directory
    try { await fs.rm(worktreeBase, { recursive: true }); } catch { /* ignore */ }

    this.emit({
      type: 'parallel_batch_complete',
      data: {
        batchId,
        totalCycles: results.length,
        merged: results.filter(r => r.merged).length,
        conflicted: results.filter(r => r.conflicted).length,
        totalCostUsd,
      },
      timestamp: new Date().toISOString(),
    });

    return { batchId, results, totalCostUsd, totalDurationMs, abortedByRateLimit };
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
