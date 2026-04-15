/**
 * Task A: Auto mode tool events — agent attribution
 *
 * Verifies that tool_input and tool_result events emitted by ClaudeExecutor
 * are forwarded to the autonomous event bus WITH agentName attribution.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AutoAgentRun } from '../../src/lib/autonomous/types';

// --- Mocks ---

vi.mock('../../src/lib/autonomous/db', () => ({
  getAutoAgents: vi.fn(),
  createAutoAgentRun: vi.fn(),
  updateAutoAgentRun: vi.fn(),
  getAllAutoSettings: vi.fn(),
  getAutoUserPrompts: vi.fn(),
  getAutoCycle: vi.fn(),
  getCEORequests: vi.fn(() => []),
  createCEORequest: vi.fn(),
}));

vi.mock('../../src/lib/db', () => ({
  getSetting: vi.fn(() => 'claude'),
}));

vi.mock('../../src/lib/autonomous/state-manager', () => ({
  StateManager: class {
    readState() { return Promise.resolve(''); }
  },
}));

vi.mock('../../src/lib/autonomous/user-prompt-builder', () => ({
  buildUserPrompt: vi.fn(() => 'test prompt'),
}));

vi.mock('../../src/lib/autonomous/agent-context-builder', () => ({
  buildAgentContext: vi.fn(() => 'mocked context'),
}));

vi.mock('../../src/lib/autonomous/output-parser', () => ({
  parseAgentOutput: vi.fn(() => ({ summary: 'test summary', structuredData: null })),
  parseCEORequests: vi.fn(() => []),
  parseTeamMessages: vi.fn(() => []),
}));

vi.mock('../../src/lib/autonomous/memory-db', () => ({
  getCrossSessionFindings: vi.fn(() => []),
  createTeamMessage: vi.fn(),
}));

vi.mock('../../src/lib/autonomous/knowledge-manager', () => ({
  KnowledgeManager: class {
    buildKnowledgeContext() {
      return { knowledge: '', teamMessages: '', wontFixSummary: '' };
    }
  },
}));

vi.mock('../../src/lib/autonomous/screen-capture', () => ({
  captureAppScreens: vi.fn(() => Promise.resolve({ frames: [] })),
}));

vi.mock('../../src/lib/autonomous/finding-extractor', () => ({
  FindingExtractor: class {
    extract() { return []; }
  },
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;

// ClaudeExecutor mock: injected per test
let mockClaudeExecutorImpl: (
  binary: string,
  onEvent: AnyFn,
  onRateLimit: AnyFn,
  onComplete: AnyFn
) => { execute: AnyFn; kill: AnyFn };

vi.mock('../../src/lib/claude-executor', () => ({
  ClaudeExecutor: class {
    private _impl: { execute: AnyFn; kill: AnyFn };
    constructor(binary: string, onEvent: AnyFn, onRateLimit: AnyFn, onComplete: AnyFn) {
      this._impl = mockClaudeExecutorImpl(binary, onEvent, onRateLimit, onComplete);
    }
    execute(...args: unknown[]) { return this._impl.execute(...args); }
    kill(...args: unknown[]) { return this._impl.kill(...args); }
  },
}));

// Helper to create a fake agent
function makeAgent(name: string, displayName: string, order: number) {
  return {
    id: `agent-${name}`,
    name,
    display_name: displayName,
    role_description: '',
    system_prompt: '',
    model: 'sonnet',
    pipeline_order: order,
    parallel_group: null,
    enabled: 1,
    is_builtin: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

describe('auto-tool-events: tool_input carries agentName', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('emits tool_input with agentName when executor fires a tool_input event', async () => {
    const {
      getAutoAgents,
      createAutoAgentRun,
      updateAutoAgentRun,
      getAllAutoSettings,
      getAutoUserPrompts,
    } = await import('../../src/lib/autonomous/db');
    const { PipelineExecutor } = await import('../../src/lib/autonomous/pipeline-executor');

    const developer = makeAgent('developer', 'Developer', 1);
    (getAllAutoSettings as ReturnType<typeof vi.fn>).mockReturnValue({
      skip_designer_for_fixes: false,
      review_max_iterations: 1,
      max_designer_iterations: 1,
      memory_enabled: false,
    });
    (getAutoAgents as ReturnType<typeof vi.fn>).mockReturnValue([developer]);
    (getAutoUserPrompts as ReturnType<typeof vi.fn>).mockReturnValue([]);

    let runCounter = 0;
    (createAutoAgentRun as ReturnType<typeof vi.fn>).mockImplementation(
      (params: Record<string, unknown>) => {
        runCounter++;
        return {
          id: `run-${runCounter}`,
          cycle_id: params.cycle_id,
          agent_id: params.agent_id,
          agent_name: params.agent_name,
          iteration: params.iteration,
          status: 'running',
          prompt: params.prompt,
          output: '',
          cost_usd: null,
          duration_ms: null,
          started_at: new Date().toISOString(),
          completed_at: null,
        } as AutoAgentRun;
      }
    );
    (updateAutoAgentRun as ReturnType<typeof vi.fn>).mockImplementation(
      (_id: string, updates: Partial<AutoAgentRun>) => ({ id: _id, ...updates } as AutoAgentRun)
    );

    // ClaudeExecutor fake: emits tool_input then calls onComplete
    mockClaudeExecutorImpl = (_binary, onEvent, _onRateLimit, onComplete) => ({
      execute: () => {
        // Synthesise a tool_input event as ClaudeExecutor would emit it
        onEvent({
          type: 'tool_input',
          data: {
            tool: 'Bash',
            id: 'tool-id-1',
            input: { command: 'echo hi' },
          },
          timestamp: new Date().toISOString(),
        });
        onComplete({
          cost_usd: 0.001,
          duration_ms: 100,
          output: 'done',
          isError: false,
          isAuthError: false,
          exitCode: 0,
        });
      },
      kill: vi.fn(),
    });

    const mockSession = {
      id: 'session-1',
      target_project: '/tmp/test-project',
      status: 'running' as const,
      total_cycles: 0,
      total_cost_usd: 0,
      config: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const emittedEvents: Array<{ type: string; data: Record<string, unknown> }> = [];
    const emitFn = vi.fn((event: { type: string; data: Record<string, unknown> }) => {
      emittedEvents.push(event);
    });

    const executor = new PipelineExecutor(mockSession, 'cycle-1', 1, emitFn as AnyFn);
    await executor.execute();

    const toolInputEvents = emittedEvents.filter((e) => e.type === 'tool_input');
    expect(toolInputEvents).toHaveLength(1);
    // Must carry agentName attribution
    expect(toolInputEvents[0].data.agentName).toBe('Developer');
    // Must carry original tool payload
    expect(toolInputEvents[0].data.tool).toBe('Bash');
    expect((toolInputEvents[0].data.input as Record<string, unknown>).command).toBe('echo hi');
  });

  it('emits tool_result with agentName when executor fires a tool_result event', async () => {
    const {
      getAutoAgents,
      createAutoAgentRun,
      updateAutoAgentRun,
      getAllAutoSettings,
      getAutoUserPrompts,
    } = await import('../../src/lib/autonomous/db');
    const { PipelineExecutor } = await import('../../src/lib/autonomous/pipeline-executor');

    const developer = makeAgent('developer', 'Developer', 1);
    (getAllAutoSettings as ReturnType<typeof vi.fn>).mockReturnValue({
      skip_designer_for_fixes: false,
      review_max_iterations: 1,
      max_designer_iterations: 1,
      memory_enabled: false,
    });
    (getAutoAgents as ReturnType<typeof vi.fn>).mockReturnValue([developer]);
    (getAutoUserPrompts as ReturnType<typeof vi.fn>).mockReturnValue([]);

    let runCounter = 0;
    (createAutoAgentRun as ReturnType<typeof vi.fn>).mockImplementation(
      (params: Record<string, unknown>) => {
        runCounter++;
        return {
          id: `run-${runCounter}`,
          cycle_id: params.cycle_id,
          agent_id: params.agent_id,
          agent_name: params.agent_name,
          iteration: params.iteration,
          status: 'running',
          prompt: params.prompt,
          output: '',
          cost_usd: null,
          duration_ms: null,
          started_at: new Date().toISOString(),
          completed_at: null,
        } as AutoAgentRun;
      }
    );
    (updateAutoAgentRun as ReturnType<typeof vi.fn>).mockImplementation(
      (_id: string, updates: Partial<AutoAgentRun>) => ({ id: _id, ...updates } as AutoAgentRun)
    );

    // ClaudeExecutor fake: emits tool_result then calls onComplete
    mockClaudeExecutorImpl = (_binary, onEvent, _onRateLimit, onComplete) => ({
      execute: () => {
        onEvent({
          type: 'tool_result',
          data: {
            tool_use_id: 'tool-id-1',
            content: 'hello world\n',
            is_error: false,
            stdout: 'hello world\n',
            stderr: '',
          },
          timestamp: new Date().toISOString(),
        });
        onComplete({
          cost_usd: 0.001,
          duration_ms: 100,
          output: 'done',
          isError: false,
          isAuthError: false,
          exitCode: 0,
        });
      },
      kill: vi.fn(),
    });

    const mockSession = {
      id: 'session-1',
      target_project: '/tmp/test-project',
      status: 'running' as const,
      total_cycles: 0,
      total_cost_usd: 0,
      config: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const emittedEvents: Array<{ type: string; data: Record<string, unknown> }> = [];
    const emitFn = vi.fn((event: { type: string; data: Record<string, unknown> }) => {
      emittedEvents.push(event);
    });

    const executor = new PipelineExecutor(mockSession, 'cycle-1', 1, emitFn as AnyFn);
    await executor.execute();

    const toolResultEvents = emittedEvents.filter((e) => e.type === 'tool_result');
    expect(toolResultEvents).toHaveLength(1);
    // Must carry agentName attribution
    expect(toolResultEvents[0].data.agentName).toBe('Developer');
    // Must carry original payload
    expect(toolResultEvents[0].data.content).toBe('hello world\n');
    expect(toolResultEvents[0].data.is_error).toBe(false);
  });

  it('preserves existing tool_start/tool_end events unchanged alongside tool_input/tool_result', async () => {
    const {
      getAutoAgents,
      createAutoAgentRun,
      updateAutoAgentRun,
      getAllAutoSettings,
      getAutoUserPrompts,
    } = await import('../../src/lib/autonomous/db');
    const { PipelineExecutor } = await import('../../src/lib/autonomous/pipeline-executor');

    const developer = makeAgent('developer', 'Developer', 1);
    (getAllAutoSettings as ReturnType<typeof vi.fn>).mockReturnValue({
      skip_designer_for_fixes: false,
      review_max_iterations: 1,
      max_designer_iterations: 1,
      memory_enabled: false,
    });
    (getAutoAgents as ReturnType<typeof vi.fn>).mockReturnValue([developer]);
    (getAutoUserPrompts as ReturnType<typeof vi.fn>).mockReturnValue([]);

    let runCounter = 0;
    (createAutoAgentRun as ReturnType<typeof vi.fn>).mockImplementation(
      (params: Record<string, unknown>) => {
        runCounter++;
        return {
          id: `run-${runCounter}`,
          cycle_id: params.cycle_id,
          agent_id: params.agent_id,
          agent_name: params.agent_name,
          iteration: params.iteration,
          status: 'running',
          prompt: params.prompt,
          output: '',
          cost_usd: null,
          duration_ms: null,
          started_at: new Date().toISOString(),
          completed_at: null,
        } as AutoAgentRun;
      }
    );
    (updateAutoAgentRun as ReturnType<typeof vi.fn>).mockImplementation(
      (_id: string, updates: Partial<AutoAgentRun>) => ({ id: _id, ...updates } as AutoAgentRun)
    );

    mockClaudeExecutorImpl = (_binary, onEvent, _onRateLimit, onComplete) => ({
      execute: () => {
        onEvent({ type: 'tool_start', data: { tool: 'Bash', id: 'tid' }, timestamp: new Date().toISOString() });
        onEvent({ type: 'tool_input', data: { tool: 'Bash', id: 'tid', input: { command: 'ls' } }, timestamp: new Date().toISOString() });
        onEvent({ type: 'tool_result', data: { tool_use_id: 'tid', content: 'file.ts', is_error: false, stdout: 'file.ts', stderr: '' }, timestamp: new Date().toISOString() });
        onEvent({ type: 'tool_end', data: { tool: 'Bash' }, timestamp: new Date().toISOString() });
        onComplete({ cost_usd: 0.001, duration_ms: 100, output: 'done', isError: false, isAuthError: false, exitCode: 0 });
      },
      kill: vi.fn(),
    });

    const mockSession = {
      id: 'session-1',
      target_project: '/tmp/test-project',
      status: 'running' as const,
      total_cycles: 0,
      total_cost_usd: 0,
      config: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const emittedEvents: Array<{ type: string; data: Record<string, unknown> }> = [];
    const emitFn = vi.fn((event: { type: string; data: Record<string, unknown> }) => {
      emittedEvents.push(event);
    });

    const executor = new PipelineExecutor(mockSession, 'cycle-1', 1, emitFn as AnyFn);
    await executor.execute();

    const types = emittedEvents.map((e) => e.type);
    expect(types).toContain('tool_start');
    expect(types).toContain('tool_input');
    expect(types).toContain('tool_result');
    expect(types).toContain('tool_end');

    // tool_input and tool_result have agentName; tool_start and tool_end may not (they're pass-through)
    const ti = emittedEvents.find((e) => e.type === 'tool_input')!;
    expect(ti.data.agentName).toBe('Developer');
    const tr = emittedEvents.find((e) => e.type === 'tool_result')!;
    expect(tr.data.agentName).toBe('Developer');
  });
});
