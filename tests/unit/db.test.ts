import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

const TEST_DB_PATH = path.join(process.cwd(), 'test-mlaude.db');

// Direct database helper functions (mirrors src/lib/db.ts logic)
let db: Database.Database;

function initTestDb(): Database.Database {
  // Clean up any previous test db
  try { fs.unlinkSync(TEST_DB_PATH); } catch {}
  try { fs.unlinkSync(TEST_DB_PATH + '-wal'); } catch {}
  try { fs.unlinkSync(TEST_DB_PATH + '-shm'); } catch {}

  const d = new Database(TEST_DB_PATH);
  d.pragma('journal_mode = WAL');
  d.pragma('foreign_keys = ON');

  d.exec(`
    CREATE TABLE IF NOT EXISTS prompts (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      queue_order INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      working_directory TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS run_sessions (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'idle',
      current_prompt_id TEXT,
      plan_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS executions (
      id TEXT PRIMARY KEY,
      prompt_id TEXT NOT NULL,
      run_session_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      output TEXT NOT NULL DEFAULT '',
      cost_usd REAL,
      duration_ms INTEGER,
      plan_id TEXT,
      effective_prompt TEXT,
      started_at TEXT NOT NULL,
      completed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS plans (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      plan_prompt TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS plan_items (
      id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL,
      prompt_id TEXT NOT NULL,
      item_order INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE CASCADE,
      FOREIGN KEY (prompt_id) REFERENCES prompts(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS plan_item_runs (
      id TEXT PRIMARY KEY,
      run_session_id TEXT NOT NULL,
      plan_item_id TEXT NOT NULL,
      prompt_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (run_session_id) REFERENCES run_sessions(id) ON DELETE CASCADE,
      FOREIGN KEY (plan_item_id) REFERENCES plan_items(id) ON DELETE CASCADE
    );
  `);

  d.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run('working_directory', process.cwd());
  d.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run('claude_binary', 'claude');
  d.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run('global_prompt', '');

  return d;
}

// Helper functions that mirror db.ts
function getPrompts() {
  return db.prepare('SELECT * FROM prompts ORDER BY queue_order ASC').all() as Array<Record<string, unknown>>;
}

function getPrompt(id: string) {
  return db.prepare('SELECT * FROM prompts WHERE id = ?').get(id) as Record<string, unknown> | undefined;
}

function createPrompt(title: string, content: string, working_directory?: string | null) {
  const id = uuidv4();
  const now = new Date().toISOString();
  const maxOrder = db.prepare('SELECT COALESCE(MAX(queue_order), -1) as max_order FROM prompts').get() as { max_order: number };
  const queueOrder = maxOrder.max_order + 1;
  db.prepare(
    'INSERT INTO prompts (id, title, content, queue_order, status, working_directory, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, title, content, queueOrder, 'pending', working_directory ?? null, now, now);
  return getPrompt(id)!;
}

function updatePrompt(id: string, data: Record<string, unknown>) {
  const existing = getPrompt(id);
  if (!existing) return undefined;
  const now = new Date().toISOString();
  const title = data.title ?? existing.title;
  const content = data.content ?? existing.content;
  const status = data.status ?? existing.status;
  const wd = data.working_directory !== undefined ? data.working_directory : existing.working_directory;
  db.prepare('UPDATE prompts SET title = ?, content = ?, status = ?, working_directory = ?, updated_at = ? WHERE id = ?').run(title, content, status, wd, now, id);
  return getPrompt(id);
}

function deletePrompt(id: string) {
  const result = db.prepare('DELETE FROM prompts WHERE id = ?').run(id);
  return result.changes > 0;
}

function reorderPrompts(orderedIds: string[]) {
  const stmt = db.prepare('UPDATE prompts SET queue_order = ?, updated_at = ? WHERE id = ?');
  const now = new Date().toISOString();
  const transaction = db.transaction(() => {
    for (let i = 0; i < orderedIds.length; i++) {
      stmt.run(i, now, orderedIds[i]);
    }
  });
  transaction();
}

function getNextPendingPrompt() {
  return db.prepare("SELECT * FROM prompts WHERE status = 'pending' ORDER BY queue_order ASC LIMIT 1").get() as Record<string, unknown> | undefined;
}

function resetPromptStatuses(startFromOrder?: number) {
  const now = new Date().toISOString();
  if (startFromOrder !== undefined) {
    const transaction = db.transaction(() => {
      db.prepare(
        "UPDATE prompts SET status = 'skipped', updated_at = ? WHERE queue_order < ?"
      ).run(now, startFromOrder);
      db.prepare(
        "UPDATE prompts SET status = 'pending', updated_at = ? WHERE queue_order >= ?"
      ).run(now, startFromOrder);
    });
    transaction();
  } else {
    db.prepare("UPDATE prompts SET status = 'pending', updated_at = ? WHERE status != 'pending'").run(now);
  }
}

function getProgressCounts() {
  const allPrompts = getPrompts();
  const completedCount = allPrompts.filter(p => p.status === 'completed').length;
  const totalCount = allPrompts.filter(p => p.status !== 'skipped').length;
  return { completedCount, totalCount };
}

function createSession(planId?: string) {
  const id = uuidv4();
  const now = new Date().toISOString();
  db.prepare('INSERT INTO run_sessions (id, status, current_prompt_id, plan_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, 'idle', null, planId ?? null, now, now);
  return getSession(id)!;
}

function getSession(id: string) {
  return db.prepare('SELECT * FROM run_sessions WHERE id = ?').get(id) as Record<string, unknown> | undefined;
}

function updateSession(id: string, data: Record<string, unknown>) {
  const existing = getSession(id);
  if (!existing) return undefined;
  const now = new Date().toISOString();
  const status = data.status ?? existing.status;
  const currentPromptId = data.current_prompt_id !== undefined ? data.current_prompt_id : existing.current_prompt_id;
  db.prepare('UPDATE run_sessions SET status = ?, current_prompt_id = ?, updated_at = ? WHERE id = ?').run(status, currentPromptId, now, id);
  return getSession(id);
}

function createExecution(data: { prompt_id: string; run_session_id: string }) {
  const id = uuidv4();
  const now = new Date().toISOString();
  db.prepare('INSERT INTO executions (id, prompt_id, run_session_id, status, output, started_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, data.prompt_id, data.run_session_id, 'running', '', now);
  return getExecution(id)!;
}

function getExecution(id: string) {
  return db.prepare('SELECT e.*, p.title as prompt_title FROM executions e LEFT JOIN prompts p ON e.prompt_id = p.id WHERE e.id = ?').get(id) as Record<string, unknown> | undefined;
}

function updateExecution(id: string, data: Record<string, unknown>) {
  const existing = getExecution(id);
  if (!existing) return undefined;
  const status = data.status ?? existing.status;
  const output = data.output ?? existing.output;
  const costUsd = data.cost_usd !== undefined ? data.cost_usd : existing.cost_usd;
  const durationMs = data.duration_ms !== undefined ? data.duration_ms : existing.duration_ms;
  const completedAt = data.completed_at !== undefined ? data.completed_at : existing.completed_at;
  db.prepare('UPDATE executions SET status = ?, output = ?, cost_usd = ?, duration_ms = ?, completed_at = ? WHERE id = ?').run(status, output, costUsd, durationMs, completedAt, id);
  return getExecution(id);
}

function getRecentExecutions(limit = 20, offset = 0) {
  return db.prepare('SELECT e.*, p.title as prompt_title FROM executions e LEFT JOIN prompts p ON e.prompt_id = p.id ORDER BY e.started_at DESC LIMIT ? OFFSET ?').all(limit, offset) as Array<Record<string, unknown>>;
}

function getSetting(key: string) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value;
}

function setSetting(key: string, value: string) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?').run(key, value, value);
}

function getAllSettings() {
  return {
    working_directory: getSetting('working_directory') ?? process.cwd(),
    claude_binary: getSetting('claude_binary') ?? 'claude',
    global_prompt: getSetting('global_prompt') ?? '',
  };
}

// --- Plan helper functions ---

function getPlans() {
  return db.prepare('SELECT * FROM plans ORDER BY created_at DESC').all() as Array<Record<string, unknown>>;
}

function getPlan(id: string) {
  return db.prepare('SELECT * FROM plans WHERE id = ?').get(id) as Record<string, unknown> | undefined;
}

function createPlan(name: string, description?: string, planPrompt?: string) {
  const id = uuidv4();
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO plans (id, name, description, plan_prompt, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, name, description ?? '', planPrompt ?? '', now, now);
  return getPlan(id)!;
}

function updatePlan(id: string, data: Record<string, unknown>) {
  const existing = getPlan(id);
  if (!existing) return undefined;
  const now = new Date().toISOString();
  const name = data.name ?? existing.name;
  const description = data.description ?? existing.description;
  const planPrompt = data.plan_prompt ?? existing.plan_prompt;
  db.prepare('UPDATE plans SET name = ?, description = ?, plan_prompt = ?, updated_at = ? WHERE id = ?').run(name, description, planPrompt, now, id);
  return getPlan(id);
}

function deletePlan(id: string) {
  const result = db.prepare('DELETE FROM plans WHERE id = ?').run(id);
  return result.changes > 0;
}

function getPlanItems(planId: string) {
  return db.prepare(
    `SELECT pi.*, p.title as prompt_title, p.content as prompt_content, p.working_directory as prompt_working_directory
     FROM plan_items pi
     LEFT JOIN prompts p ON pi.prompt_id = p.id
     WHERE pi.plan_id = ?
     ORDER BY pi.item_order ASC`
  ).all(planId) as Array<Record<string, unknown>>;
}

function addPlanItem(planId: string, promptId: string) {
  const id = uuidv4();
  const now = new Date().toISOString();
  const maxOrder = db.prepare(
    'SELECT COALESCE(MAX(item_order), -1) as max_order FROM plan_items WHERE plan_id = ?'
  ).get(planId) as { max_order: number };
  const itemOrder = maxOrder.max_order + 1;
  db.prepare(
    'INSERT INTO plan_items (id, plan_id, prompt_id, item_order, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(id, planId, promptId, itemOrder, now);
  return db.prepare(
    `SELECT pi.*, p.title as prompt_title, p.content as prompt_content
     FROM plan_items pi
     LEFT JOIN prompts p ON pi.prompt_id = p.id
     WHERE pi.id = ?`
  ).get(id) as Record<string, unknown>;
}

function removePlanItem(planItemId: string) {
  const item = db.prepare('SELECT * FROM plan_items WHERE id = ?').get(planItemId) as Record<string, unknown> | undefined;
  if (!item) return false;
  db.prepare('DELETE FROM plan_items WHERE id = ?').run(planItemId);
  // Reorder remaining
  const remaining = db.prepare(
    'SELECT id FROM plan_items WHERE plan_id = ? ORDER BY item_order ASC'
  ).all(item.plan_id as string) as Array<{ id: string }>;
  const stmt = db.prepare('UPDATE plan_items SET item_order = ? WHERE id = ?');
  const transaction = db.transaction(() => {
    for (let i = 0; i < remaining.length; i++) {
      stmt.run(i, remaining[i].id);
    }
  });
  transaction();
  return true;
}

function reorderPlanItems(planId: string, orderedItemIds: string[]) {
  const stmt = db.prepare('UPDATE plan_items SET item_order = ? WHERE id = ? AND plan_id = ?');
  const transaction = db.transaction(() => {
    for (let i = 0; i < orderedItemIds.length; i++) {
      stmt.run(i, orderedItemIds[i], planId);
    }
  });
  transaction();
}

function createPlanItemRuns(sessionId: string, planId: string, startFromItemOrder?: number) {
  const items = getPlanItems(planId);
  const now = new Date().toISOString();
  const stmt = db.prepare(
    'INSERT INTO plan_item_runs (id, run_session_id, plan_item_id, prompt_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  const transaction = db.transaction(() => {
    for (const item of items) {
      const status = (startFromItemOrder !== undefined && (item.item_order as number) < startFromItemOrder) ? 'skipped' : 'pending';
      stmt.run(uuidv4(), sessionId, item.id as string, item.prompt_id as string, status, now, now);
    }
  });
  transaction();
  return getPlanItemRuns(sessionId);
}

function getPlanItemRuns(sessionId: string) {
  return db.prepare(
    `SELECT pir.*, p.title as prompt_title, pi.item_order
     FROM plan_item_runs pir
     LEFT JOIN prompts p ON pir.prompt_id = p.id
     LEFT JOIN plan_items pi ON pir.plan_item_id = pi.id
     WHERE pir.run_session_id = ?
     ORDER BY pi.item_order ASC`
  ).all(sessionId) as Array<Record<string, unknown>>;
}

function getNextPendingPlanItemRun(sessionId: string) {
  return db.prepare(
    `SELECT pir.*, p.title as prompt_title, pi.item_order
     FROM plan_item_runs pir
     LEFT JOIN prompts p ON pir.prompt_id = p.id
     LEFT JOIN plan_items pi ON pir.plan_item_id = pi.id
     WHERE pir.run_session_id = ? AND pir.status = 'pending'
     ORDER BY pi.item_order ASC
     LIMIT 1`
  ).get(sessionId) as Record<string, unknown> | undefined;
}

function updatePlanItemRun(id: string, data: { status: string }) {
  const now = new Date().toISOString();
  db.prepare('UPDATE plan_item_runs SET status = ?, updated_at = ? WHERE id = ?').run(data.status, now, id);
}

describe('Database Operations', () => {
  beforeEach(() => {
    if (db) {
      try { db.close(); } catch {}
    }
    db = initTestDb();
  });

  afterAll(() => {
    if (db) {
      try { db.close(); } catch {}
    }
    try { fs.unlinkSync(TEST_DB_PATH); } catch {}
    try { fs.unlinkSync(TEST_DB_PATH + '-wal'); } catch {}
    try { fs.unlinkSync(TEST_DB_PATH + '-shm'); } catch {}
  });

  describe('Prompt CRUD', () => {
    it('should create a prompt', () => {
      const prompt = createPrompt('Test Title', 'Test Content');
      expect(prompt).toBeDefined();
      expect(prompt.title).toBe('Test Title');
      expect(prompt.content).toBe('Test Content');
      expect(prompt.status).toBe('pending');
      expect(prompt.queue_order).toBe(0);
    });

    it('should auto-increment queue_order', () => {
      const p1 = createPrompt('First', 'Content 1');
      const p2 = createPrompt('Second', 'Content 2');
      expect(p1.queue_order).toBe(0);
      expect(p2.queue_order).toBe(1);
    });

    it('should create prompt with working_directory', () => {
      const prompt = createPrompt('Test', 'Content', '/some/path');
      expect(prompt.working_directory).toBe('/some/path');
    });

    it('should create prompt with null working_directory', () => {
      const prompt = createPrompt('Test', 'Content', null);
      expect(prompt.working_directory).toBeNull();
    });

    it('should get all prompts ordered by queue_order', () => {
      createPrompt('First', 'Content 1');
      createPrompt('Second', 'Content 2');
      createPrompt('Third', 'Content 3');

      const prompts = getPrompts();
      expect(prompts).toHaveLength(3);
      expect(prompts[0].title).toBe('First');
      expect(prompts[1].title).toBe('Second');
      expect(prompts[2].title).toBe('Third');
    });

    it('should get a prompt by id', () => {
      const created = createPrompt('Test', 'Content');
      const fetched = getPrompt(created.id as string);
      expect(fetched).toBeDefined();
      expect(fetched!.id).toBe(created.id);
    });

    it('should return undefined for non-existent prompt', () => {
      const fetched = getPrompt('non-existent-id');
      expect(fetched).toBeUndefined();
    });

    it('should update a prompt', () => {
      const created = createPrompt('Original', 'Original content');
      const updated = updatePrompt(created.id as string, { title: 'Updated' });
      expect(updated!.title).toBe('Updated');
      expect(updated!.content).toBe('Original content');
    });

    it('should update prompt status', () => {
      const created = createPrompt('Test', 'Content');
      const updated = updatePrompt(created.id as string, { status: 'running' });
      expect(updated!.status).toBe('running');
    });

    it('should return undefined when updating non-existent prompt', () => {
      const result = updatePrompt('non-existent', { title: 'Nope' });
      expect(result).toBeUndefined();
    });

    it('should delete a prompt', () => {
      const created = createPrompt('Test', 'Content');
      const deleted = deletePrompt(created.id as string);
      expect(deleted).toBe(true);
      expect(getPrompt(created.id as string)).toBeUndefined();
    });

    it('should return false when deleting non-existent prompt', () => {
      const deleted = deletePrompt('non-existent');
      expect(deleted).toBe(false);
    });
  });

  describe('Prompt Queue Operations', () => {
    it('should reorder prompts', () => {
      const p1 = createPrompt('First', 'C1');
      const p2 = createPrompt('Second', 'C2');
      const p3 = createPrompt('Third', 'C3');

      reorderPrompts([p3.id as string, p1.id as string, p2.id as string]);

      const prompts = getPrompts();
      expect(prompts[0].title).toBe('Third');
      expect(prompts[1].title).toBe('First');
      expect(prompts[2].title).toBe('Second');
    });

    it('should get next pending prompt', () => {
      createPrompt('First', 'C1');
      createPrompt('Second', 'C2');

      const next = getNextPendingPrompt();
      expect(next).toBeDefined();
      expect(next!.title).toBe('First');
    });

    it('should return undefined when no pending prompts', () => {
      const p = createPrompt('Test', 'Content');
      updatePrompt(p.id as string, { status: 'completed' });

      const next = getNextPendingPrompt();
      expect(next).toBeUndefined();
    });

    it('should reset prompt statuses to pending', () => {
      const p1 = createPrompt('P1', 'C1');
      const p2 = createPrompt('P2', 'C2');
      updatePrompt(p1.id as string, { status: 'completed' });
      updatePrompt(p2.id as string, { status: 'failed' });

      resetPromptStatuses();

      const prompts = getPrompts();
      expect(prompts.every(p => p.status === 'pending')).toBe(true);
    });

    it('should mark earlier prompts as skipped when starting from a specific order', () => {
      createPrompt('P1', 'C1'); // queue_order 0
      createPrompt('P2', 'C2'); // queue_order 1
      createPrompt('P3', 'C3'); // queue_order 2
      createPrompt('P4', 'C4'); // queue_order 3

      resetPromptStatuses(2); // start from P3

      const prompts = getPrompts();
      expect(prompts[0].status).toBe('skipped');
      expect(prompts[1].status).toBe('skipped');
      expect(prompts[2].status).toBe('pending');
      expect(prompts[3].status).toBe('pending');
    });

    it('should mark all prompts as pending when starting from order 0', () => {
      createPrompt('P1', 'C1');
      createPrompt('P2', 'C2');
      createPrompt('P3', 'C3');

      resetPromptStatuses(0);

      const prompts = getPrompts();
      expect(prompts.every(p => p.status === 'pending')).toBe(true);
    });
  });

  describe('Progress Calculation with Skipped Prompts', () => {
    it('should exclude skipped prompts from totalCount', () => {
      createPrompt('P1', 'C1'); // queue_order 0
      createPrompt('P2', 'C2'); // queue_order 1
      createPrompt('P3', 'C3'); // queue_order 2
      createPrompt('P4', 'C4'); // queue_order 3

      resetPromptStatuses(2); // skip P1, P2

      const { completedCount, totalCount } = getProgressCounts();
      expect(totalCount).toBe(2); // only P3, P4 (pending)
      expect(completedCount).toBe(0);
    });

    it('should show correct progress after completing some prompts', () => {
      const p1 = createPrompt('P1', 'C1'); // queue_order 0
      createPrompt('P2', 'C2'); // queue_order 1
      const p3 = createPrompt('P3', 'C3'); // queue_order 2
      createPrompt('P4', 'C4'); // queue_order 3

      resetPromptStatuses(2); // skip P1, P2
      updatePrompt(p3.id as string, { status: 'completed' });

      const { completedCount, totalCount } = getProgressCounts();
      expect(totalCount).toBe(2);
      expect(completedCount).toBe(1);
    });

    it('should show 100% when all non-skipped prompts are completed', () => {
      createPrompt('P1', 'C1'); // queue_order 0
      createPrompt('P2', 'C2'); // queue_order 1
      const p3 = createPrompt('P3', 'C3'); // queue_order 2
      const p4 = createPrompt('P4', 'C4'); // queue_order 3

      resetPromptStatuses(2); // skip P1, P2
      updatePrompt(p3.id as string, { status: 'completed' });
      updatePrompt(p4.id as string, { status: 'completed' });

      const { completedCount, totalCount } = getProgressCounts();
      expect(totalCount).toBe(2);
      expect(completedCount).toBe(2);
      expect(Math.round((completedCount / totalCount) * 100)).toBe(100);
    });

    it('should count all prompts when no prompts are skipped', () => {
      const p1 = createPrompt('P1', 'C1');
      const p2 = createPrompt('P2', 'C2');
      const p3 = createPrompt('P3', 'C3');

      updatePrompt(p1.id as string, { status: 'completed' });
      updatePrompt(p2.id as string, { status: 'completed' });

      const { completedCount, totalCount } = getProgressCounts();
      expect(totalCount).toBe(3);
      expect(completedCount).toBe(2);
    });

    it('should not count failed prompts as completed but include in total', () => {
      createPrompt('P1', 'C1'); // queue_order 0
      const p2 = createPrompt('P2', 'C2'); // queue_order 1
      const p3 = createPrompt('P3', 'C3'); // queue_order 2

      resetPromptStatuses(1); // skip P1
      updatePrompt(p2.id as string, { status: 'completed' });
      updatePrompt(p3.id as string, { status: 'failed' });

      const { completedCount, totalCount } = getProgressCounts();
      expect(totalCount).toBe(2); // P2 + P3 (failed still counts in total)
      expect(completedCount).toBe(1); // only P2
    });
  });

  describe('Session Operations', () => {
    it('should create a session', () => {
      const session = createSession();
      expect(session).toBeDefined();
      expect(session.status).toBe('idle');
      expect(session.current_prompt_id).toBeNull();
    });

    it('should create a session with plan_id', () => {
      const plan = createPlan('Test Plan');
      const session = createSession(plan.id as string);
      expect(session).toBeDefined();
      expect(session.plan_id).toBe(plan.id);
    });

    it('should update session status', () => {
      const session = createSession();
      const updated = updateSession(session.id as string, { status: 'running' });
      expect(updated!.status).toBe('running');
    });

    it('should update session current_prompt_id', () => {
      const session = createSession();
      const updated = updateSession(session.id as string, { current_prompt_id: 'prompt-123' });
      expect(updated!.current_prompt_id).toBe('prompt-123');
    });
  });

  describe('Execution Operations', () => {
    it('should create an execution', () => {
      const prompt = createPrompt('Test', 'Content');
      const session = createSession();
      const execution = createExecution({
        prompt_id: prompt.id as string,
        run_session_id: session.id as string,
      });
      expect(execution).toBeDefined();
      expect(execution.status).toBe('running');
      expect(execution.output).toBe('');
    });

    it('should update execution', () => {
      const prompt = createPrompt('Test', 'Content');
      const session = createSession();
      const exec = createExecution({
        prompt_id: prompt.id as string,
        run_session_id: session.id as string,
      });

      const updated = updateExecution(exec.id as string, {
        status: 'completed',
        output: 'Done',
        cost_usd: 0.05,
        duration_ms: 3000,
        completed_at: new Date().toISOString(),
      });
      expect(updated!.status).toBe('completed');
      expect(updated!.output).toBe('Done');
      expect(updated!.cost_usd).toBe(0.05);
    });

    it('should get recent executions', () => {
      const prompt = createPrompt('Test', 'Content');
      const session = createSession();
      createExecution({ prompt_id: prompt.id as string, run_session_id: session.id as string });
      createExecution({ prompt_id: prompt.id as string, run_session_id: session.id as string });

      const executions = getRecentExecutions(10, 0);
      expect(executions).toHaveLength(2);
    });

    it('should join prompt_title in executions', () => {
      const prompt = createPrompt('My Prompt', 'Content');
      const session = createSession();
      const exec = createExecution({
        prompt_id: prompt.id as string,
        run_session_id: session.id as string,
      });
      expect(exec.prompt_title).toBe('My Prompt');
    });
  });

  describe('Settings Operations', () => {
    it('should get default settings', () => {
      const settings = getAllSettings();
      expect(settings.working_directory).toBeDefined();
      expect(settings.claude_binary).toBe('claude');
      expect(settings.global_prompt).toBe('');
    });

    it('should set and get a setting', () => {
      setSetting('claude_binary', '/usr/local/bin/claude');
      const value = getSetting('claude_binary');
      expect(value).toBe('/usr/local/bin/claude');
    });

    it('should update existing setting', () => {
      setSetting('working_directory', '/new/path');
      const settings = getAllSettings();
      expect(settings.working_directory).toBe('/new/path');
    });

    it('should set and get global_prompt', () => {
      setSetting('global_prompt', 'Always respond in JSON');
      const settings = getAllSettings();
      expect(settings.global_prompt).toBe('Always respond in JSON');
    });
  });

  describe('Plan CRUD', () => {
    it('should create a plan', () => {
      const plan = createPlan('My Plan', 'Description', 'Plan prompt');
      expect(plan).toBeDefined();
      expect(plan.name).toBe('My Plan');
      expect(plan.description).toBe('Description');
      expect(plan.plan_prompt).toBe('Plan prompt');
    });

    it('should create a plan with defaults', () => {
      const plan = createPlan('Basic Plan');
      expect(plan.description).toBe('');
      expect(plan.plan_prompt).toBe('');
    });

    it('should get all plans', () => {
      createPlan('Plan A');
      createPlan('Plan B');
      const plans = getPlans();
      expect(plans).toHaveLength(2);
    });

    it('should get plan by id', () => {
      const created = createPlan('Test Plan');
      const fetched = getPlan(created.id as string);
      expect(fetched).toBeDefined();
      expect(fetched!.name).toBe('Test Plan');
    });

    it('should return undefined for non-existent plan', () => {
      expect(getPlan('non-existent')).toBeUndefined();
    });

    it('should update a plan', () => {
      const plan = createPlan('Original');
      const updated = updatePlan(plan.id as string, { name: 'Updated', description: 'New desc' });
      expect(updated!.name).toBe('Updated');
      expect(updated!.description).toBe('New desc');
    });

    it('should update plan_prompt', () => {
      const plan = createPlan('Plan', '', '');
      const updated = updatePlan(plan.id as string, { plan_prompt: 'New prompt' });
      expect(updated!.plan_prompt).toBe('New prompt');
    });

    it('should delete a plan', () => {
      const plan = createPlan('To Delete');
      expect(deletePlan(plan.id as string)).toBe(true);
      expect(getPlan(plan.id as string)).toBeUndefined();
    });

    it('should return false when deleting non-existent plan', () => {
      expect(deletePlan('non-existent')).toBe(false);
    });

    it('should cascade delete plan items when plan is deleted', () => {
      const plan = createPlan('Plan');
      const prompt = createPrompt('P1', 'C1');
      addPlanItem(plan.id as string, prompt.id as string);

      const itemsBefore = getPlanItems(plan.id as string);
      expect(itemsBefore).toHaveLength(1);

      deletePlan(plan.id as string);

      const itemsAfter = getPlanItems(plan.id as string);
      expect(itemsAfter).toHaveLength(0);
    });
  });

  describe('Plan Items', () => {
    it('should add a plan item', () => {
      const plan = createPlan('Plan');
      const prompt = createPrompt('P1', 'Content');
      const item = addPlanItem(plan.id as string, prompt.id as string);
      expect(item).toBeDefined();
      expect(item.prompt_title).toBe('P1');
      expect(item.item_order).toBe(0);
    });

    it('should auto-increment item_order', () => {
      const plan = createPlan('Plan');
      const p1 = createPrompt('P1', 'C1');
      const p2 = createPrompt('P2', 'C2');

      addPlanItem(plan.id as string, p1.id as string);
      addPlanItem(plan.id as string, p2.id as string);

      const items = getPlanItems(plan.id as string);
      expect(items).toHaveLength(2);
      expect(items[0].item_order).toBe(0);
      expect(items[1].item_order).toBe(1);
    });

    it('should get plan items with joined prompt data', () => {
      const plan = createPlan('Plan');
      const prompt = createPrompt('Title', 'Content body');
      addPlanItem(plan.id as string, prompt.id as string);

      const items = getPlanItems(plan.id as string);
      expect(items[0].prompt_title).toBe('Title');
      expect(items[0].prompt_content).toBe('Content body');
    });

    it('should remove a plan item and reorder', () => {
      const plan = createPlan('Plan');
      const p1 = createPrompt('P1', 'C1');
      const p2 = createPrompt('P2', 'C2');
      const p3 = createPrompt('P3', 'C3');

      addPlanItem(plan.id as string, p1.id as string);
      const item2 = addPlanItem(plan.id as string, p2.id as string);
      addPlanItem(plan.id as string, p3.id as string);

      removePlanItem(item2.id as string);

      const items = getPlanItems(plan.id as string);
      expect(items).toHaveLength(2);
      expect(items[0].prompt_title).toBe('P1');
      expect(items[0].item_order).toBe(0);
      expect(items[1].prompt_title).toBe('P3');
      expect(items[1].item_order).toBe(1);
    });

    it('should return false when removing non-existent item', () => {
      expect(removePlanItem('non-existent')).toBe(false);
    });

    it('should reorder plan items', () => {
      const plan = createPlan('Plan');
      const p1 = createPrompt('P1', 'C1');
      const p2 = createPrompt('P2', 'C2');
      const p3 = createPrompt('P3', 'C3');

      const i1 = addPlanItem(plan.id as string, p1.id as string);
      const i2 = addPlanItem(plan.id as string, p2.id as string);
      const i3 = addPlanItem(plan.id as string, p3.id as string);

      reorderPlanItems(plan.id as string, [i3.id as string, i1.id as string, i2.id as string]);

      const items = getPlanItems(plan.id as string);
      expect(items[0].prompt_title).toBe('P3');
      expect(items[1].prompt_title).toBe('P1');
      expect(items[2].prompt_title).toBe('P2');
    });

    it('should allow same prompt in plan multiple times', () => {
      const plan = createPlan('Plan');
      const prompt = createPrompt('P1', 'C1');

      addPlanItem(plan.id as string, prompt.id as string);
      addPlanItem(plan.id as string, prompt.id as string);

      const items = getPlanItems(plan.id as string);
      expect(items).toHaveLength(2);
    });
  });

  describe('Plan Item Runs', () => {
    it('should create plan item runs for all items', () => {
      const plan = createPlan('Plan');
      const p1 = createPrompt('P1', 'C1');
      const p2 = createPrompt('P2', 'C2');
      const p3 = createPrompt('P3', 'C3');

      addPlanItem(plan.id as string, p1.id as string);
      addPlanItem(plan.id as string, p2.id as string);
      addPlanItem(plan.id as string, p3.id as string);

      const session = createSession(plan.id as string);
      const runs = createPlanItemRuns(session.id as string, plan.id as string);

      expect(runs).toHaveLength(3);
      expect(runs.every(r => r.status === 'pending')).toBe(true);
    });

    it('should create plan item runs with skipped items when startFromItemOrder specified', () => {
      const plan = createPlan('Plan');
      const p1 = createPrompt('P1', 'C1');
      const p2 = createPrompt('P2', 'C2');
      const p3 = createPrompt('P3', 'C3');

      addPlanItem(plan.id as string, p1.id as string);
      addPlanItem(plan.id as string, p2.id as string);
      addPlanItem(plan.id as string, p3.id as string);

      const session = createSession(plan.id as string);
      const runs = createPlanItemRuns(session.id as string, plan.id as string, 1);

      expect(runs).toHaveLength(3);
      expect(runs[0].status).toBe('skipped');  // item_order 0
      expect(runs[1].status).toBe('pending');   // item_order 1
      expect(runs[2].status).toBe('pending');   // item_order 2
    });

    it('should get next pending plan item run', () => {
      const plan = createPlan('Plan');
      const p1 = createPrompt('P1', 'C1');
      const p2 = createPrompt('P2', 'C2');

      addPlanItem(plan.id as string, p1.id as string);
      addPlanItem(plan.id as string, p2.id as string);

      const session = createSession(plan.id as string);
      createPlanItemRuns(session.id as string, plan.id as string);

      const next = getNextPendingPlanItemRun(session.id as string);
      expect(next).toBeDefined();
      expect(next!.prompt_title).toBe('P1');
      expect(next!.item_order).toBe(0);
    });

    it('should return undefined when no pending plan item runs', () => {
      const plan = createPlan('Plan');
      const p1 = createPrompt('P1', 'C1');

      addPlanItem(plan.id as string, p1.id as string);

      const session = createSession(plan.id as string);
      const runs = createPlanItemRuns(session.id as string, plan.id as string);

      updatePlanItemRun(runs[0].id as string, { status: 'completed' });

      const next = getNextPendingPlanItemRun(session.id as string);
      expect(next).toBeUndefined();
    });

    it('should update plan item run status', () => {
      const plan = createPlan('Plan');
      const p1 = createPrompt('P1', 'C1');

      addPlanItem(plan.id as string, p1.id as string);

      const session = createSession(plan.id as string);
      const runs = createPlanItemRuns(session.id as string, plan.id as string);

      updatePlanItemRun(runs[0].id as string, { status: 'running' });

      const updatedRuns = getPlanItemRuns(session.id as string);
      expect(updatedRuns[0].status).toBe('running');
    });

    it('should get next pending after completing first', () => {
      const plan = createPlan('Plan');
      const p1 = createPrompt('P1', 'C1');
      const p2 = createPrompt('P2', 'C2');

      addPlanItem(plan.id as string, p1.id as string);
      addPlanItem(plan.id as string, p2.id as string);

      const session = createSession(plan.id as string);
      const runs = createPlanItemRuns(session.id as string, plan.id as string);

      updatePlanItemRun(runs[0].id as string, { status: 'completed' });

      const next = getNextPendingPlanItemRun(session.id as string);
      expect(next).toBeDefined();
      expect(next!.prompt_title).toBe('P2');
    });
  });

  describe('Progress with Plans', () => {
    it('should calculate progress from plan item runs', () => {
      const plan = createPlan('Plan');
      const p1 = createPrompt('P1', 'C1');
      const p2 = createPrompt('P2', 'C2');
      const p3 = createPrompt('P3', 'C3');

      addPlanItem(plan.id as string, p1.id as string);
      addPlanItem(plan.id as string, p2.id as string);
      addPlanItem(plan.id as string, p3.id as string);

      const session = createSession(plan.id as string);
      const runs = createPlanItemRuns(session.id as string, plan.id as string);

      updatePlanItemRun(runs[0].id as string, { status: 'completed' });

      const allRuns = getPlanItemRuns(session.id as string);
      const completedCount = allRuns.filter(r => r.status === 'completed').length;
      const totalCount = allRuns.filter(r => r.status !== 'skipped').length;

      expect(completedCount).toBe(1);
      expect(totalCount).toBe(3);
    });

    it('should exclude skipped plan item runs from total', () => {
      const plan = createPlan('Plan');
      const p1 = createPrompt('P1', 'C1');
      const p2 = createPrompt('P2', 'C2');
      const p3 = createPrompt('P3', 'C3');

      addPlanItem(plan.id as string, p1.id as string);
      addPlanItem(plan.id as string, p2.id as string);
      addPlanItem(plan.id as string, p3.id as string);

      const session = createSession(plan.id as string);
      const runs = createPlanItemRuns(session.id as string, plan.id as string, 1);

      const allRuns = getPlanItemRuns(session.id as string);
      const completedCount = allRuns.filter(r => r.status === 'completed').length;
      const totalCount = allRuns.filter(r => r.status !== 'skipped').length;

      expect(completedCount).toBe(0);
      expect(totalCount).toBe(2); // only items with order >= 1
    });
  });
});
