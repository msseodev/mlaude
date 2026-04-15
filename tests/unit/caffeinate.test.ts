import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { ChildProcess } from 'child_process';

// Mock child_process before importing the module
vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

describe('CaffeinateManager', () => {
  let CaffeinateManager: typeof import('@/lib/caffeinate').CaffeinateManager;
  let spawn: ReturnType<typeof vi.fn>;
  let manager: InstanceType<typeof CaffeinateManager>;

  beforeEach(async () => {
    vi.resetModules();

    const cp = await import('child_process');
    spawn = cp.spawn as unknown as ReturnType<typeof vi.fn>;
    spawn.mockClear();

    // Default: simulate a spawned process
    const fakeProcess = {
      pid: 12345,
      killed: false,
      kill: vi.fn(function (this: { killed: boolean }) {
        this.killed = true;
      }),
      on: vi.fn(),
    } as unknown as ChildProcess;
    spawn.mockReturnValue(fakeProcess);

    const mod = await import('@/lib/caffeinate');
    CaffeinateManager = mod.CaffeinateManager;
    manager = new CaffeinateManager();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('acquire', () => {
    it('should increment refCount on acquire', () => {
      expect(manager.getRefCount()).toBe(0);
      manager.acquire();
      expect(manager.getRefCount()).toBe(1);
    });

    it('should increment refCount multiple times', () => {
      manager.acquire();
      manager.acquire();
      manager.acquire();
      expect(manager.getRefCount()).toBe(3);
    });

    it('should spawn caffeinate process on first acquire (darwin)', () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'darwin' });

      manager.acquire();

      expect(spawn).toHaveBeenCalledWith('caffeinate', ['-dims'], {
        stdio: 'ignore',
        detached: false,
      });

      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    it('should only spawn one process for multiple acquires', () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'darwin' });

      manager.acquire();
      manager.acquire();
      manager.acquire();

      expect(spawn).toHaveBeenCalledTimes(1);

      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    it('should not spawn process on non-darwin platforms', () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'linux' });

      manager.acquire();

      expect(spawn).not.toHaveBeenCalled();

      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });
  });

  describe('release', () => {
    it('should decrement refCount on release', () => {
      manager.acquire();
      manager.acquire();
      expect(manager.getRefCount()).toBe(2);

      manager.release();
      expect(manager.getRefCount()).toBe(1);
    });

    it('should stop caffeinate when refCount reaches 0', () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'darwin' });

      manager.acquire();
      expect(manager.isActive()).toBe(true);

      manager.release();
      expect(manager.getRefCount()).toBe(0);
      expect(manager.isActive()).toBe(false);

      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    it('should not go below 0 on extra release calls', () => {
      manager.release();
      manager.release();
      expect(manager.getRefCount()).toBe(0);
    });

    it('should kill the process with SIGTERM when stopping', () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'darwin' });

      const fakeProcess = {
        pid: 99999,
        killed: false,
        kill: vi.fn(function (this: { killed: boolean }) {
          this.killed = true;
        }),
        on: vi.fn(),
      } as unknown as ChildProcess;
      spawn.mockReturnValue(fakeProcess);

      manager.acquire();
      manager.release();

      expect(fakeProcess.kill).toHaveBeenCalledWith('SIGTERM');

      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });
  });

  describe('isActive', () => {
    it('should return false when no process is running', () => {
      expect(manager.isActive()).toBe(false);
    });

    it('should return true when process is running (darwin)', () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'darwin' });

      manager.acquire();
      expect(manager.isActive()).toBe(true);

      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    it('should return false after release to 0', () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'darwin' });

      manager.acquire();
      manager.release();
      expect(manager.isActive()).toBe(false);

      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    it('should return false on non-darwin even after acquire', () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'linux' });

      manager.acquire();
      expect(manager.isActive()).toBe(false);

      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });
  });

  describe('getRefCount', () => {
    it('should start at 0', () => {
      expect(manager.getRefCount()).toBe(0);
    });

    it('should correctly track acquire/release pairs', () => {
      manager.acquire();
      manager.acquire();
      expect(manager.getRefCount()).toBe(2);

      manager.release();
      expect(manager.getRefCount()).toBe(1);

      manager.acquire();
      expect(manager.getRefCount()).toBe(2);

      manager.release();
      manager.release();
      expect(manager.getRefCount()).toBe(0);
    });
  });

  describe('error handling', () => {
    it('should handle spawn errors gracefully', () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'darwin' });

      spawn.mockImplementation(() => {
        throw new Error('spawn failed');
      });

      // Should not throw
      expect(() => manager.acquire()).not.toThrow();
      expect(manager.isActive()).toBe(false);
      expect(manager.getRefCount()).toBe(1);

      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    it('should handle process error event by clearing process ref', () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'darwin' });

      const handlers: Record<string, () => void> = {};
      const fakeProcess = {
        pid: 12345,
        killed: false,
        kill: vi.fn(),
        on: vi.fn((event: string, handler: () => void) => {
          handlers[event] = handler;
        }),
      } as unknown as ChildProcess;
      spawn.mockReturnValue(fakeProcess);

      manager.acquire();
      expect(manager.isActive()).toBe(true);

      // Simulate error event
      handlers['error']();
      expect(manager.isActive()).toBe(false);

      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    it('should handle process exit event by clearing process ref', () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'darwin' });

      const handlers: Record<string, () => void> = {};
      const fakeProcess = {
        pid: 12345,
        killed: false,
        kill: vi.fn(),
        on: vi.fn((event: string, handler: () => void) => {
          handlers[event] = handler;
        }),
      } as unknown as ChildProcess;
      spawn.mockReturnValue(fakeProcess);

      manager.acquire();
      expect(manager.isActive()).toBe(true);

      // Simulate exit event
      handlers['exit']();
      expect(manager.isActive()).toBe(false);

      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });
  });

  describe('re-acquire after full release', () => {
    it('should spawn a new process when acquiring after full release', () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'darwin' });

      // First acquire/release cycle
      manager.acquire();
      manager.release();
      expect(spawn).toHaveBeenCalledTimes(1);
      expect(manager.isActive()).toBe(false);

      // Second acquire should spawn again
      manager.acquire();
      expect(spawn).toHaveBeenCalledTimes(2);

      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });
  });
});
