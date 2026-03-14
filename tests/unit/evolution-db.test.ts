import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';

let testDb: Database.Database;

// Mock getDb to return our in-memory test database
vi.mock('../../src/lib/db', () => ({
  getDb: () => testDb,
}));

import {
  createPromptVariant,
  getActiveVariant,
  updatePromptVariant,
  getVariantHistory,
  initEvolutionTables,
} from '@/lib/autonomous/evolution-db';

function setupTestDb(): void {
  testDb = new Database(':memory:');
  testDb.pragma('journal_mode = WAL');
  testDb.pragma('foreign_keys = ON');

  // Create prerequisite tables
  testDb.exec(`
    CREATE TABLE IF NOT EXISTS auto_agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      role_description TEXT NOT NULL,
      system_prompt TEXT NOT NULL,
      pipeline_order REAL NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      is_builtin INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  // Seed agents for tests
  const now = new Date().toISOString();
  testDb.prepare(
    'INSERT OR IGNORE INTO auto_agents (id, name, display_name, role_description, system_prompt, pipeline_order, enabled, is_builtin, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?, ?)'
  ).run('agent-1', 'developer', 'Developer', 'Implements code', 'You are a developer.', 2, now, now);

  testDb.prepare(
    'INSERT OR IGNORE INTO auto_agents (id, name, display_name, role_description, system_prompt, pipeline_order, enabled, is_builtin, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?, ?)'
  ).run('agent-2', 'reviewer', 'Reviewer', 'Reviews code', 'You are a reviewer.', 3, now, now);

  // Initialize evolution tables via the actual module function
  initEvolutionTables();
}

// Helper: create a variant and advance fake clock to ensure distinct timestamps
function createVariantWithDistinctTime(data: Parameters<typeof createPromptVariant>[0]) {
  const variant = createPromptVariant(data);
  vi.advanceTimersByTime(1000);
  return variant;
}

// --- Tests ---

describe('Evolution DB Operations', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    if (testDb) {
      try { testDb.close(); } catch { /* ignore */ }
    }
    setupTestDb();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('createPromptVariant', () => {
    it('should create and return a variant', () => {
      const variant = createPromptVariant({
        agent_id: 'agent-1',
        system_prompt: 'You are an improved developer.',
      });
      expect(variant).toBeDefined();
      expect(variant.agent_id).toBe('agent-1');
      expect(variant.system_prompt).toBe('You are an improved developer.');
      expect(variant.parent_variant_id).toBeNull();
      expect(variant.generation).toBe(0);
      expect(variant.status).toBe('active');
      expect(variant.avg_score).toBeNull();
      expect(variant.cycles_evaluated).toBe(0);
      expect(variant.created_at).toBeDefined();
    });

    it('should create a variant with parent and generation', () => {
      const parent = createPromptVariant({
        agent_id: 'agent-1',
        system_prompt: 'Original prompt',
        generation: 0,
        status: 'active',
      });
      const child = createPromptVariant({
        agent_id: 'agent-1',
        system_prompt: 'Evolved prompt',
        parent_variant_id: parent.id,
        generation: 1,
        status: 'evaluating',
      });
      expect(child.parent_variant_id).toBe(parent.id);
      expect(child.generation).toBe(1);
      expect(child.status).toBe('evaluating');
    });
  });

  describe('getActiveVariant', () => {
    it('should return the active variant for an agent', () => {
      createPromptVariant({
        agent_id: 'agent-1',
        system_prompt: 'Active prompt',
        status: 'active',
      });
      createPromptVariant({
        agent_id: 'agent-1',
        system_prompt: 'Retired prompt',
        status: 'retired',
      });

      const active = getActiveVariant('agent-1');
      expect(active).toBeDefined();
      expect(active!.system_prompt).toBe('Active prompt');
      expect(active!.status).toBe('active');
    });

    it('should return undefined when no active variant exists', () => {
      createPromptVariant({
        agent_id: 'agent-1',
        system_prompt: 'Retired prompt',
        status: 'retired',
      });

      const active = getActiveVariant('agent-1');
      expect(active).toBeUndefined();
    });

    it('should return undefined for agent with no variants', () => {
      const active = getActiveVariant('agent-2');
      expect(active).toBeUndefined();
    });
  });

  describe('updatePromptVariant', () => {
    it('should update status and avg_score', () => {
      const variant = createPromptVariant({
        agent_id: 'agent-1',
        system_prompt: 'Test prompt',
        status: 'evaluating',
      });

      const updated = updatePromptVariant(variant.id, {
        status: 'active',
        avg_score: 75.5,
      });
      expect(updated).toBeDefined();
      expect(updated!.status).toBe('active');
      expect(updated!.avg_score).toBeCloseTo(75.5);
    });

    it('should update cycles_evaluated', () => {
      const variant = createPromptVariant({
        agent_id: 'agent-1',
        system_prompt: 'Test prompt',
        status: 'evaluating',
      });

      const updated = updatePromptVariant(variant.id, {
        cycles_evaluated: 5,
      });
      expect(updated).toBeDefined();
      expect(updated!.cycles_evaluated).toBe(5);
      expect(updated!.status).toBe('evaluating'); // unchanged
    });

    it('should return undefined for non-existent variant', () => {
      const result = updatePromptVariant('non-existent', { status: 'retired' });
      expect(result).toBeUndefined();
    });
  });

  describe('getVariantHistory', () => {
    it('should return variants in reverse chronological order', () => {
      createVariantWithDistinctTime({
        agent_id: 'agent-1',
        system_prompt: 'First',
        generation: 0,
      });
      createVariantWithDistinctTime({
        agent_id: 'agent-1',
        system_prompt: 'Second',
        generation: 1,
      });
      createVariantWithDistinctTime({
        agent_id: 'agent-1',
        system_prompt: 'Third',
        generation: 2,
      });

      const history = getVariantHistory('agent-1');
      expect(history).toHaveLength(3);
      expect(history[0].system_prompt).toBe('Third');
      expect(history[1].system_prompt).toBe('Second');
      expect(history[2].system_prompt).toBe('First');
    });

    it('should respect limit parameter', () => {
      createVariantWithDistinctTime({
        agent_id: 'agent-1',
        system_prompt: 'First',
        generation: 0,
      });
      createVariantWithDistinctTime({
        agent_id: 'agent-1',
        system_prompt: 'Second',
        generation: 1,
      });
      createVariantWithDistinctTime({
        agent_id: 'agent-1',
        system_prompt: 'Third',
        generation: 2,
      });

      const history = getVariantHistory('agent-1', 2);
      expect(history).toHaveLength(2);
      expect(history[0].system_prompt).toBe('Third');
      expect(history[1].system_prompt).toBe('Second');
    });

    it('should not return variants for other agents', () => {
      createPromptVariant({
        agent_id: 'agent-1',
        system_prompt: 'Agent 1 variant',
      });
      createPromptVariant({
        agent_id: 'agent-2',
        system_prompt: 'Agent 2 variant',
      });

      const history = getVariantHistory('agent-1');
      expect(history).toHaveLength(1);
      expect(history[0].agent_id).toBe('agent-1');
    });

    it('should return empty array when no variants exist', () => {
      const history = getVariantHistory('agent-2');
      expect(history).toHaveLength(0);
    });
  });
});
