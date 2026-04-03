import { describe, it, expect, vi } from 'vitest';

// Mock all dependencies that pipeline-executor imports at module level
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

vi.mock('../../src/lib/claude-executor', () => ({
  ClaudeExecutor: class {
    execute() { return; }
    kill() { return; }
  },
}));

import { PLANNER_AGENT_NAMES, isPlannerAgent } from '../../src/lib/autonomous/pipeline-executor';
import type { AutoAgent } from '../../src/lib/autonomous/types';

function makeAgent(name: string): AutoAgent {
  return {
    id: `agent-${name}`,
    name,
    display_name: name,
    role_description: '',
    system_prompt: '',
    model: 'sonnet',
    pipeline_order: 1,
    parallel_group: null,
    enabled: 1,
    is_builtin: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

describe('PLANNER_AGENT_NAMES', () => {
  it('contains all 8 planner agent names', () => {
    expect(PLANNER_AGENT_NAMES.has('product_designer')).toBe(true);
    expect(PLANNER_AGENT_NAMES.has('ux_planner')).toBe(true);
    expect(PLANNER_AGENT_NAMES.has('tech_planner')).toBe(true);
    expect(PLANNER_AGENT_NAMES.has('analyzer')).toBe(true);
    expect(PLANNER_AGENT_NAMES.has('biz_planner')).toBe(true);
    expect(PLANNER_AGENT_NAMES.has('music_domain_planner')).toBe(true);
    expect(PLANNER_AGENT_NAMES.has('planning_moderator')).toBe(true);
    expect(PLANNER_AGENT_NAMES.has('smoke_tester')).toBe(true);
  });

  it('has exactly 8 members', () => {
    expect(PLANNER_AGENT_NAMES.size).toBe(8);
  });
});

describe('isPlannerAgent', () => {
  it('returns true for all 8 planner agents', () => {
    const plannerNames = ['product_designer', 'ux_planner', 'tech_planner', 'analyzer', 'biz_planner', 'music_domain_planner', 'planning_moderator', 'smoke_tester'];
    for (const name of plannerNames) {
      expect(isPlannerAgent(makeAgent(name))).toBe(true);
    }
  });

  it('returns false for non-planner agents', () => {
    const nonPlannerNames = ['developer', 'reviewer', 'qa_engineer', 'test_engineer'];
    for (const name of nonPlannerNames) {
      expect(isPlannerAgent(makeAgent(name))).toBe(false);
    }
  });
});
