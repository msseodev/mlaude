import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import type { KnowledgeEntry, TeamMessage, AutoFinding } from '@/lib/autonomous/types';

// Mock memory-db module
const mockGetKnowledgeEntries = vi.fn<(...args: unknown[]) => KnowledgeEntry[]>().mockReturnValue([]);
const mockGetTeamMessages = vi.fn<(...args: unknown[]) => TeamMessage[]>().mockReturnValue([]);
const mockGetCrossSessionFindings = vi.fn<(...args: unknown[]) => AutoFinding[]>().mockReturnValue([]);

vi.mock('@/lib/autonomous/memory-db', () => ({
  getKnowledgeEntries: (...args: unknown[]) => mockGetKnowledgeEntries(...args),
  getTeamMessages: (...args: unknown[]) => mockGetTeamMessages(...args),
  getCrossSessionFindings: (...args: unknown[]) => mockGetCrossSessionFindings(...args),
}));

// Must import after mocks
import { KnowledgeManager } from '@/lib/autonomous/knowledge-manager';

function makeKnowledgeEntry(overrides: Partial<KnowledgeEntry> = {}): KnowledgeEntry {
  return {
    id: 'ke-1',
    project_path: '/test/project',
    category: 'coding_convention',
    title: 'Use strict TypeScript',
    content: 'Always enable strict mode in tsconfig.json',
    source_session_id: 'session-1',
    source_agent: 'Reviewer',
    occurrence_count: 3,
    last_seen_at: '2026-03-01T00:00:00Z',
    created_at: '2026-02-01T00:00:00Z',
    superseded_by: null,
    ...overrides,
  };
}

function makeTeamMessage(overrides: Partial<TeamMessage> = {}): TeamMessage {
  return {
    id: 'tm-1',
    project_path: '/test/project',
    session_id: 'session-1',
    cycle_id: 'cycle-1',
    from_agent: 'Reviewer',
    category: 'convention',
    content: 'Prefer arrow functions over function declarations',
    created_at: '2026-03-01T00:00:00Z',
    ...overrides,
  };
}

function makeFinding(overrides: Partial<AutoFinding> = {}): AutoFinding {
  return {
    id: 'f-1',
    session_id: 'session-1',
    category: 'bug',
    priority: 'P1',
    title: 'Memory leak in event handler',
    description: 'Event listeners are not cleaned up on unmount',
    file_path: 'src/hooks/useEvent.ts',
    status: 'wont_fix',
    retry_count: 3,
    max_retries: 3,
    resolved_by_cycle_id: null,
    failure_history: null,
    created_at: '2026-02-01T00:00:00Z',
    updated_at: '2026-03-01T00:00:00Z',
    ...overrides,
  };
}

describe('KnowledgeManager', () => {
  let manager: KnowledgeManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new KnowledgeManager('/test/project');
  });

  describe('buildKnowledgeContext', () => {
    it('returns empty strings when no data exists', () => {
      mockGetKnowledgeEntries.mockReturnValue([]);
      mockGetTeamMessages.mockReturnValue([]);
      mockGetCrossSessionFindings.mockReturnValue([]);

      const result = manager.buildKnowledgeContext('developer');

      expect(result.knowledge).toBe('');
      expect(result.teamMessages).toBe('');
      expect(result.wontFixSummary).toBe('');
    });

    it('filters knowledge entries by planning_team_lead role — sees architecture_decision and known_limitation', () => {
      mockGetKnowledgeEntries.mockReturnValue([
        makeKnowledgeEntry({ category: 'architecture_decision', title: 'Use MVC', content: 'Follow MVC pattern' }),
        makeKnowledgeEntry({ id: 'ke-2', category: 'coding_convention', title: 'Use camelCase', content: 'All variables in camelCase' }),
        makeKnowledgeEntry({ id: 'ke-3', category: 'known_limitation', title: 'No SSR', content: 'Server-side rendering not supported' }),
        makeKnowledgeEntry({ id: 'ke-4', category: 'resolved_pattern', title: 'Fix login', content: 'Login fix pattern' }),
      ]);
      mockGetTeamMessages.mockReturnValue([]);
      mockGetCrossSessionFindings.mockReturnValue([]);

      const result = manager.buildKnowledgeContext('planning_team_lead');

      expect(result.knowledge).toContain('Use MVC');
      expect(result.knowledge).toContain('No SSR');
      expect(result.knowledge).not.toContain('Use camelCase');
      expect(result.knowledge).not.toContain('Fix login');
    });

    it('filters knowledge entries by developer role — sees coding_convention and resolved_pattern', () => {
      mockGetKnowledgeEntries.mockReturnValue([
        makeKnowledgeEntry({ category: 'architecture_decision', title: 'Use MVC', content: 'Follow MVC pattern' }),
        makeKnowledgeEntry({ id: 'ke-2', category: 'coding_convention', title: 'Use camelCase', content: 'All variables in camelCase' }),
        makeKnowledgeEntry({ id: 'ke-3', category: 'known_limitation', title: 'No SSR', content: 'SSR not supported' }),
        makeKnowledgeEntry({ id: 'ke-4', category: 'resolved_pattern', title: 'Fix login', content: 'Login fix pattern' }),
      ]);
      mockGetTeamMessages.mockReturnValue([]);
      mockGetCrossSessionFindings.mockReturnValue([]);

      const result = manager.buildKnowledgeContext('developer');

      expect(result.knowledge).toContain('Use camelCase');
      expect(result.knowledge).toContain('Fix login');
      expect(result.knowledge).not.toContain('Use MVC');
      expect(result.knowledge).not.toContain('No SSR');
    });

    it('filters knowledge entries by smoke_tester role — sees resolved_pattern only', () => {
      mockGetKnowledgeEntries.mockReturnValue([
        makeKnowledgeEntry({ category: 'coding_convention', title: 'Use camelCase', content: 'All variables in camelCase' }),
        makeKnowledgeEntry({ id: 'ke-2', category: 'resolved_pattern', title: 'Fix login', content: 'Login fix pattern' }),
      ]);
      mockGetTeamMessages.mockReturnValue([]);
      mockGetCrossSessionFindings.mockReturnValue([]);

      const result = manager.buildKnowledgeContext('smoke_tester');

      expect(result.knowledge).toContain('Fix login');
      expect(result.knowledge).not.toContain('Use camelCase');
    });

    it('returns all knowledge categories for unknown role', () => {
      mockGetKnowledgeEntries.mockReturnValue([
        makeKnowledgeEntry({ category: 'architecture_decision', title: 'Use MVC', content: 'Follow MVC pattern' }),
        makeKnowledgeEntry({ id: 'ke-2', category: 'coding_convention', title: 'Use camelCase', content: 'All variables in camelCase' }),
        makeKnowledgeEntry({ id: 'ke-3', category: 'resolved_pattern', title: 'Fix login', content: 'Login fix pattern' }),
      ]);
      mockGetTeamMessages.mockReturnValue([]);
      mockGetCrossSessionFindings.mockReturnValue([]);

      const result = manager.buildKnowledgeContext('some_unknown_role');

      expect(result.knowledge).toContain('Use MVC');
      expect(result.knowledge).toContain('Use camelCase');
      expect(result.knowledge).toContain('Fix login');
    });

    it('filters team messages by agent role', () => {
      mockGetKnowledgeEntries.mockReturnValue([]);
      mockGetTeamMessages.mockReturnValue([
        makeTeamMessage({ category: 'convention', content: 'Use strict mode' }),
        makeTeamMessage({ id: 'tm-2', category: 'architecture', content: 'Use microservices' }),
        makeTeamMessage({ id: 'tm-3', category: 'warning', content: 'Watch for memory leaks' }),
        makeTeamMessage({ id: 'tm-4', category: 'pattern', content: 'Retry pattern with backoff' }),
      ]);
      mockGetCrossSessionFindings.mockReturnValue([]);

      // Developer sees convention, pattern, warning
      const devResult = manager.buildKnowledgeContext('developer');
      expect(devResult.teamMessages).toContain('Use strict mode');
      expect(devResult.teamMessages).toContain('Watch for memory leaks');
      expect(devResult.teamMessages).toContain('Retry pattern with backoff');
      expect(devResult.teamMessages).not.toContain('Use microservices');

      // Planner sees architecture, warning, limitation
      const plannerResult = manager.buildKnowledgeContext('planning_team_lead');
      expect(plannerResult.teamMessages).toContain('Use microservices');
      expect(plannerResult.teamMessages).toContain('Watch for memory leaks');
      expect(plannerResult.teamMessages).not.toContain('Use strict mode');
      expect(plannerResult.teamMessages).not.toContain('Retry pattern with backoff');
    });

    it('builds wontFixSummary only with wont_fix findings', () => {
      mockGetKnowledgeEntries.mockReturnValue([]);
      mockGetTeamMessages.mockReturnValue([]);
      // The manager calls getCrossSessionFindings with ['wont_fix'] status filter,
      // so mock should return only wont_fix findings (DB handles the filtering)
      mockGetCrossSessionFindings.mockReturnValue([
        makeFinding({ title: 'Cannot fix memory leak', status: 'wont_fix', description: 'Third-party library issue' }),
      ]);

      const result = manager.buildKnowledgeContext('planning_team_lead');

      expect(result.wontFixSummary).toContain('Cannot fix memory leak');
      expect(result.wontFixSummary).toContain('Third-party library issue');
      // Verify getCrossSessionFindings was called with correct status filter
      expect(mockGetCrossSessionFindings).toHaveBeenCalledWith('/test/project', ['wont_fix']);
    });

    it('respects maxChars limit', () => {
      // Create knowledge entries with very long content
      const longEntries: KnowledgeEntry[] = [];
      for (let i = 0; i < 50; i++) {
        longEntries.push(makeKnowledgeEntry({
          id: `ke-${i}`,
          category: 'coding_convention',
          title: `Convention ${i}`,
          content: 'A'.repeat(200),
        }));
      }
      mockGetKnowledgeEntries.mockReturnValue(longEntries);
      mockGetTeamMessages.mockReturnValue([]);
      mockGetCrossSessionFindings.mockReturnValue([]);

      const maxChars = 500;
      const result = manager.buildKnowledgeContext('developer', maxChars);

      // Total of all sections should not exceed maxChars
      const totalLen = result.knowledge.length + result.teamMessages.length + result.wontFixSummary.length;
      expect(totalLen).toBeLessThanOrEqual(maxChars);
    });

    it('respects budget allocation percentages', () => {
      // Provide data for all three sections
      const entries: KnowledgeEntry[] = [];
      for (let i = 0; i < 20; i++) {
        entries.push(makeKnowledgeEntry({
          id: `ke-${i}`,
          category: 'coding_convention',
          title: `Convention ${i}`,
          content: 'B'.repeat(100),
        }));
      }
      mockGetKnowledgeEntries.mockReturnValue(entries);

      const messages: TeamMessage[] = [];
      for (let i = 0; i < 20; i++) {
        messages.push(makeTeamMessage({
          id: `tm-${i}`,
          category: 'convention',
          content: 'C'.repeat(100),
        }));
      }
      mockGetTeamMessages.mockReturnValue(messages);

      const findings: AutoFinding[] = [];
      for (let i = 0; i < 20; i++) {
        findings.push(makeFinding({
          id: `f-${i}`,
          title: `Wontfix ${i}`,
          status: 'wont_fix',
          description: 'D'.repeat(100),
        }));
      }
      mockGetCrossSessionFindings.mockReturnValue(findings);

      const maxChars = 3500;
      const result = manager.buildKnowledgeContext('developer', maxChars);

      // knowledge should be at most 60% of budget
      expect(result.knowledge.length).toBeLessThanOrEqual(maxChars * 0.6 + 1);
      // teamMessages should be at most 25% of budget
      expect(result.teamMessages.length).toBeLessThanOrEqual(maxChars * 0.25 + 1);
    });
  });

  describe('readProjectKnowledge', () => {
    it('returns null when file does not exist', async () => {
      const tempManager = new KnowledgeManager('/nonexistent/path/for/test');
      const result = await tempManager.readProjectKnowledge();
      expect(result).toBeNull();
    });
  });

  describe('syncKnowledgeFile', () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = await fs.mkdtemp('/tmp/knowledge-manager-test-');
      manager = new KnowledgeManager(tempDir);
    });

    afterEach(async () => {
      try {
        await fs.rm(tempDir, { recursive: true });
      } catch { /* ignore */ }
    });

    it('creates the markdown file with correct sections', async () => {
      mockGetKnowledgeEntries.mockReturnValue([
        makeKnowledgeEntry({ category: 'architecture_decision', title: 'Use MVC', content: 'Follow MVC pattern' }),
        makeKnowledgeEntry({ id: 'ke-2', category: 'coding_convention', title: 'Use camelCase', content: 'All variables in camelCase' }),
        makeKnowledgeEntry({ id: 'ke-3', category: 'known_limitation', title: 'No SSR', content: 'SSR not supported' }),
        makeKnowledgeEntry({ id: 'ke-4', category: 'resolved_pattern', title: 'Fix login', content: 'Login fix pattern' }),
      ]);

      await manager.syncKnowledgeFile();

      const content = await fs.readFile(`${tempDir}/.mlaude/PROJECT-KNOWLEDGE.md`, 'utf-8');
      expect(content).toContain('# Project Knowledge');
      expect(content).toContain('Auto-generated by mlaude');
      expect(content).toContain('## Architecture Decisions');
      expect(content).toContain('- Use MVC: Follow MVC pattern');
      expect(content).toContain('## Coding Conventions');
      expect(content).toContain('- Use camelCase: All variables in camelCase');
      expect(content).toContain('## Known Limitations');
      expect(content).toContain('- No SSR: SSR not supported');
      expect(content).toContain('## Resolved Patterns');
      expect(content).toContain('- Fix login: Login fix pattern');
    });

    it('creates .mlaude directory if it does not exist', async () => {
      mockGetKnowledgeEntries.mockReturnValue([]);

      await manager.syncKnowledgeFile();

      const stat = await fs.stat(`${tempDir}/.mlaude`);
      expect(stat.isDirectory()).toBe(true);
    });
  });

  describe('constructor tilde expansion', () => {
    it('resolves ~ to home directory', () => {
      const homeManager = new KnowledgeManager('~/my-project');
      const result = homeManager.buildKnowledgeContext('developer');
      // Should not throw — just verifying it doesn't crash with tilde path
      expect(result).toBeDefined();
    });
  });
});
