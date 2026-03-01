import { execFile } from 'child_process';
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

  async createCheckpoint(label: string): Promise<string | null> {
    try {
      // Stage all changes
      await this.execGit(['add', '-A']);

      // Check if there are staged changes
      let hasChanges = false;
      try {
        await this.execGit(['diff', '--cached', '--quiet']);
        // Exit code 0 means no changes
        hasChanges = false;
      } catch {
        // Exit code 1 means there are changes
        hasChanges = true;
      }

      if (hasChanges) {
        await this.execGit(['commit', '-m', `[mclaude-auto] checkpoint: ${label}`]);
      }

      return await this.getCurrentSha();
    } catch {
      return null;
    }
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

  private async execGit(args: string[]): Promise<{ stdout: string; stderr: string }> {
    return execFileAsync('git', args, { cwd: this.resolvedPath });
  }
}
