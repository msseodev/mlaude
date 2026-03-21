import { execFile } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export class GitManager {
  private resolvedPath: string;

  constructor(private projectPath: string) {
    this.resolvedPath = projectPath.startsWith('~')
      ? path.join(os.homedir(), projectPath.slice(1))
      : projectPath;
  }

  async isGitRepo(): Promise<boolean> {
    try {
      await this.execGit(['rev-parse', '--git-dir']);
      return true;
    } catch {
      return false;
    }
  }

  async getCurrentSha(): Promise<string | null> {
    try {
      const { stdout } = await this.execGit(['rev-parse', 'HEAD']);
      return stdout.trim() || null;
    } catch {
      return null;
    }
  }

  async ensureBranch(branchName: string): Promise<void> {
    try {
      await this.execGit(['rev-parse', '--verify', branchName]);
      // Branch exists, check it out
      await this.execGit(['checkout', branchName]);
    } catch {
      // Branch does not exist, create and check it out
      await this.execGit(['checkout', '-b', branchName]);
    }
  }

  async createCheckpoint(): Promise<string | null> {
    return this.getCurrentSha();
  }

  async commitCycleResult(message: string): Promise<string | null> {
    try {
      await this.execGit(['add', '-A']);

      let hasChanges = false;
      try {
        await this.execGit(['diff', '--cached', '--quiet']);
        hasChanges = false;
      } catch {
        hasChanges = true;
      }

      if (hasChanges) {
        await this.execGit(['commit', '-m', message]);
      }

      return await this.getCurrentSha();
    } catch {
      return null;
    }
  }

  async rollback(commitSha: string): Promise<boolean> {
    try {
      await this.execGit(['reset', '--hard', commitSha]);
      return true;
    } catch {
      return false;
    }
  }

  async getDiff(fromSha: string): Promise<string> {
    try {
      const { stdout } = await this.execGit(['diff', `${fromSha}..HEAD`]);
      return stdout;
    } catch {
      return '';
    }
  }

  async commitAll(message: string): Promise<string | null> {
    try {
      await this.execGit(['add', '-A']);

      let hasChanges = false;
      try {
        await this.execGit(['diff', '--cached', '--quiet']);
        hasChanges = false;
      } catch {
        hasChanges = true;
      }

      if (hasChanges) {
        await this.execGit(['commit', '-m', message]);
      }

      return await this.getCurrentSha();
    } catch {
      return null;
    }
  }

  async createWorktree(branchName: string, worktreePath: string): Promise<boolean> {
    try {
      await this.execGit(['worktree', 'add', '-b', branchName, worktreePath]);
      return true;
    } catch {
      return false;
    }
  }

  async removeWorktree(worktreePath: string): Promise<boolean> {
    try {
      await this.execGit(['worktree', 'remove', worktreePath, '--force']);
      return true;
    } catch {
      return false;
    }
  }

  async mergeWorktreeBranch(branchName: string): Promise<{ success: boolean; conflicted: boolean }> {
    try {
      await this.execGit(['merge', '--no-ff', branchName]);
      return { success: true, conflicted: false };
    } catch {
      // Check if this is actually a conflict (not some other error)
      const conflictedFiles = await this.getConflictedFiles();
      if (conflictedFiles.length > 0) {
        return { success: false, conflicted: true };
      }
      // Not a conflict, some other git error — abort
      try { await this.execGit(['merge', '--abort']); } catch { /* ignore */ }
      return { success: false, conflicted: false };
    }
  }

  async getConflictedFiles(): Promise<string[]> {
    try {
      const { stdout } = await this.execGit(['diff', '--name-only', '--diff-filter=U']);
      return stdout.trim().split('\n').filter(Boolean);
    } catch {
      return [];
    }
  }

  async abortMerge(): Promise<void> {
    try { await this.execGit(['merge', '--abort']); } catch { /* ignore */ }
  }

  async completeMerge(message: string): Promise<boolean> {
    try {
      await this.execGit(['add', '-A']);
      await this.execGit(['commit', '-m', message]);
      return true;
    } catch {
      return false;
    }
  }

  async deleteBranch(branchName: string): Promise<void> {
    try {
      await this.execGit(['branch', '-D', branchName]);
    } catch {
      // Branch may not exist, ignore
    }
  }

  async cleanupStaleWorktrees(): Promise<void> {
    // Remove .mclaude/worktrees/ directory if exists
    const worktreesDir = path.join(this.resolvedPath, '.mclaude', 'worktrees');
    try {
      await fs.rm(worktreesDir, { recursive: true });
    } catch {
      // Directory may not exist
    }

    // Prune stale worktree references
    try {
      await this.execGit(['worktree', 'prune']);
    } catch {
      // Ignore prune errors
    }

    // Ensure .mclaude/worktrees is gitignored
    const gitignorePath = path.join(this.resolvedPath, '.gitignore');
    try {
      const content = await fs.readFile(gitignorePath, 'utf-8');
      if (!content.includes('.mclaude/worktrees')) {
        await fs.appendFile(gitignorePath, '\n.mclaude/worktrees/\n');
      }
    } catch {
      // No .gitignore or read error, skip
    }
  }

  private async execGit(args: string[]): Promise<{ stdout: string; stderr: string }> {
    return execFileAsync('git', args, { cwd: this.resolvedPath });
  }
}
