import Database from 'better-sqlite3';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { Prompt, RunSession, Execution, Settings, Plan, PlanItem, PlanItemRun, PlanWithItems, ChatSession, ChatMessage } from './types';

const DB_PATH = path.join(process.cwd(), 'mlaude.db');

const globalForDb = globalThis as unknown as { __mlaudeDb: Database.Database };

function initDb(): Database.Database {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
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

    CREATE TABLE IF NOT EXISTS chat_sessions (
      id TEXT PRIMARY KEY,
      claude_session_id TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT 'New Chat',
      working_directory TEXT NOT NULL,
      model TEXT,
      status TEXT NOT NULL DEFAULT 'idle',
      total_cost_usd REAL NOT NULL DEFAULT 0,
      message_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      cost_usd REAL,
      duration_ms INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Migrations for existing tables
  const runSessionCols = db.prepare("PRAGMA table_info(run_sessions)").all() as Array<{ name: string }>;
  if (!runSessionCols.some(c => c.name === 'plan_id')) {
    db.exec('ALTER TABLE run_sessions ADD COLUMN plan_id TEXT');
  }

  const executionCols = db.prepare("PRAGMA table_info(executions)").all() as Array<{ name: string }>;
  if (!executionCols.some(c => c.name === 'plan_id')) {
    db.exec('ALTER TABLE executions ADD COLUMN plan_id TEXT');
  }
  if (!executionCols.some(c => c.name === 'effective_prompt')) {
    db.exec('ALTER TABLE executions ADD COLUMN effective_prompt TEXT');
  }

  // Insert default settings if not exist
  const insertSetting = db.prepare(
    'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)'
  );
  insertSetting.run('working_directory', process.cwd());
  insertSetting.run('claude_binary', 'claude');
  insertSetting.run('global_prompt', '');

  return db;
}

export function getDb(): Database.Database {
  if (!globalForDb.__mlaudeDb) {
    globalForDb.__mlaudeDb = initDb();
  }
  return globalForDb.__mlaudeDb;
}

// --- Prompt CRUD ---

export function getPrompts(): Prompt[] {
  const db = getDb();
  return db.prepare('SELECT * FROM prompts ORDER BY queue_order ASC').all() as Prompt[];
}

/** Returns a map of prompt_id -> array of { plan_id, plan_name } */
export function getPromptPlanMap(): Record<string, { plan_id: string; plan_name: string }[]> {
  const db = getDb();
  const rows = db.prepare(
    `SELECT pi.prompt_id, p.id as plan_id, p.name as plan_name
     FROM plan_items pi
     JOIN plans p ON pi.plan_id = p.id
     ORDER BY p.name ASC`
  ).all() as { prompt_id: string; plan_id: string; plan_name: string }[];

  const map: Record<string, { plan_id: string; plan_name: string }[]> = {};
  for (const row of rows) {
    if (!map[row.prompt_id]) map[row.prompt_id] = [];
    map[row.prompt_id].push({ plan_id: row.plan_id, plan_name: row.plan_name });
  }
  return map;
}

export function getPrompt(id: string): Prompt | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM prompts WHERE id = ?').get(id) as Prompt | undefined;
}

export function createPrompt(title: string, content: string, working_directory?: string | null): Prompt {
  const db = getDb();
  const id = uuidv4();
  const now = new Date().toISOString();
  const maxOrder = db.prepare('SELECT COALESCE(MAX(queue_order), -1) as max_order FROM prompts').get() as { max_order: number };
  const queueOrder = maxOrder.max_order + 1;

  db.prepare(
    'INSERT INTO prompts (id, title, content, queue_order, status, working_directory, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, title, content, queueOrder, 'pending', working_directory ?? null, now, now);

  return getPrompt(id)!;
}

export function updatePrompt(id: string, data: Partial<Pick<Prompt, 'title' | 'content' | 'status' | 'working_directory'>>): Prompt | undefined {
  const db = getDb();
  const existing = getPrompt(id);
  if (!existing) return undefined;

  const now = new Date().toISOString();
  const title = data.title ?? existing.title;
  const content = data.content ?? existing.content;
  const status = data.status ?? existing.status;
  const workingDirectory = data.working_directory !== undefined ? data.working_directory : existing.working_directory;

  db.prepare(
    'UPDATE prompts SET title = ?, content = ?, status = ?, working_directory = ?, updated_at = ? WHERE id = ?'
  ).run(title, content, status, workingDirectory, now, id);

  return getPrompt(id);
}

export function deletePrompt(id: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM prompts WHERE id = ?').run(id);
  return result.changes > 0;
}

export function reorderPrompts(orderedIds: string[]): void {
  const db = getDb();
  const stmt = db.prepare('UPDATE prompts SET queue_order = ?, updated_at = ? WHERE id = ?');
  const now = new Date().toISOString();

  const transaction = db.transaction(() => {
    for (let i = 0; i < orderedIds.length; i++) {
      stmt.run(i, now, orderedIds[i]);
    }
  });
  transaction();
}

export function getNextPendingPrompt(): Prompt | undefined {
  const db = getDb();
  return db.prepare(
    "SELECT * FROM prompts WHERE status = 'pending' ORDER BY queue_order ASC LIMIT 1"
  ).get() as Prompt | undefined;
}

export function resetPromptStatuses(startFromOrder?: number): void {
  const db = getDb();
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
    db.prepare(
      "UPDATE prompts SET status = 'pending', updated_at = ? WHERE status != 'pending'"
    ).run(now);
  }
}

// --- Run Session helpers ---

export function createSession(planId?: string): RunSession {
  const db = getDb();
  const id = uuidv4();
  const now = new Date().toISOString();

  db.prepare(
    'INSERT INTO run_sessions (id, status, current_prompt_id, plan_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, 'idle', null, planId ?? null, now, now);

  return getSession(id)!;
}

export function getSession(id: string): RunSession | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM run_sessions WHERE id = ?').get(id) as RunSession | undefined;
}

export function updateSession(id: string, data: Partial<Pick<RunSession, 'status' | 'current_prompt_id'>>): RunSession | undefined {
  const db = getDb();
  const existing = getSession(id);
  if (!existing) return undefined;

  const now = new Date().toISOString();
  const status = data.status ?? existing.status;
  const currentPromptId = data.current_prompt_id !== undefined ? data.current_prompt_id : existing.current_prompt_id;

  db.prepare(
    'UPDATE run_sessions SET status = ?, current_prompt_id = ?, updated_at = ? WHERE id = ?'
  ).run(status, currentPromptId, now, id);

  return getSession(id);
}

export function getLatestSession(): RunSession | undefined {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM run_sessions ORDER BY created_at DESC LIMIT 1'
  ).get() as RunSession | undefined;
}

// --- Execution helpers ---

export function createExecution(data: { prompt_id: string; run_session_id: string; plan_id?: string; effective_prompt?: string }): Execution {
  const db = getDb();
  const id = uuidv4();
  const now = new Date().toISOString();

  db.prepare(
    'INSERT INTO executions (id, prompt_id, run_session_id, status, output, plan_id, effective_prompt, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, data.prompt_id, data.run_session_id, 'running', '', data.plan_id ?? null, data.effective_prompt ?? null, now);

  return getExecution(id)!;
}

export function updateExecution(id: string, data: Partial<Pick<Execution, 'status' | 'output' | 'cost_usd' | 'duration_ms' | 'completed_at'>>): Execution | undefined {
  const db = getDb();
  const existing = getExecution(id);
  if (!existing) return undefined;

  const status = data.status ?? existing.status;
  const output = data.output ?? existing.output;
  const costUsd = data.cost_usd !== undefined ? data.cost_usd : existing.cost_usd;
  const durationMs = data.duration_ms !== undefined ? data.duration_ms : existing.duration_ms;
  const completedAt = data.completed_at !== undefined ? data.completed_at : existing.completed_at;

  db.prepare(
    'UPDATE executions SET status = ?, output = ?, cost_usd = ?, duration_ms = ?, completed_at = ? WHERE id = ?'
  ).run(status, output, costUsd, durationMs, completedAt, id);

  return getExecution(id);
}

export function getExecution(id: string): Execution | undefined {
  const db = getDb();
  return db.prepare(
    'SELECT e.*, p.title as prompt_title FROM executions e LEFT JOIN prompts p ON e.prompt_id = p.id WHERE e.id = ?'
  ).get(id) as Execution | undefined;
}

export function getExecutionsBySession(sessionId: string): Execution[] {
  const db = getDb();
  return db.prepare(
    'SELECT e.*, p.title as prompt_title FROM executions e LEFT JOIN prompts p ON e.prompt_id = p.id WHERE e.run_session_id = ? ORDER BY e.started_at ASC'
  ).all(sessionId) as Execution[];
}

export function getRecentExecutions(limit: number = 20, offset: number = 0): Execution[] {
  const db = getDb();
  return db.prepare(
    'SELECT e.*, p.title as prompt_title FROM executions e LEFT JOIN prompts p ON e.prompt_id = p.id ORDER BY e.started_at DESC LIMIT ? OFFSET ?'
  ).all(limit, offset) as Execution[];
}

// --- Settings helpers ---

export function getSetting(key: string): string | undefined {
  const db = getDb();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value;
}

export function setSetting(key: string, value: string): void {
  const db = getDb();
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?'
  ).run(key, value, value);
}

export function getAllSettings(): Settings {
  return {
    working_directory: getSetting('working_directory') ?? process.cwd(),
    claude_binary: getSetting('claude_binary') ?? 'claude',
    global_prompt: getSetting('global_prompt') ?? '',
  };
}

// --- Plan CRUD ---

export function getPlans(): Plan[] {
  const db = getDb();
  return db.prepare('SELECT * FROM plans ORDER BY created_at DESC').all() as Plan[];
}

export function getPlan(id: string): Plan | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM plans WHERE id = ?').get(id) as Plan | undefined;
}

export function getPlanWithItems(id: string): PlanWithItems | undefined {
  const plan = getPlan(id);
  if (!plan) return undefined;
  const items = getPlanItems(id);
  return { ...plan, items };
}

export function createPlan(name: string, description?: string, planPrompt?: string): Plan {
  const db = getDb();
  const id = uuidv4();
  const now = new Date().toISOString();

  db.prepare(
    'INSERT INTO plans (id, name, description, plan_prompt, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, name, description ?? '', planPrompt ?? '', now, now);

  return getPlan(id)!;
}

export function updatePlan(id: string, data: Partial<Pick<Plan, 'name' | 'description' | 'plan_prompt'>>): Plan | undefined {
  const db = getDb();
  const existing = getPlan(id);
  if (!existing) return undefined;

  const now = new Date().toISOString();
  const name = data.name ?? existing.name;
  const description = data.description ?? existing.description;
  const planPrompt = data.plan_prompt ?? existing.plan_prompt;

  db.prepare(
    'UPDATE plans SET name = ?, description = ?, plan_prompt = ?, updated_at = ? WHERE id = ?'
  ).run(name, description, planPrompt, now, id);

  return getPlan(id);
}

export function deletePlan(id: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM plans WHERE id = ?').run(id);
  return result.changes > 0;
}

// --- Plan Item helpers ---

export function getPlanItems(planId: string): PlanItem[] {
  const db = getDb();
  return db.prepare(
    `SELECT pi.*, p.title as prompt_title, p.content as prompt_content, p.working_directory as prompt_working_directory
     FROM plan_items pi
     LEFT JOIN prompts p ON pi.prompt_id = p.id
     WHERE pi.plan_id = ?
     ORDER BY pi.item_order ASC`
  ).all(planId) as PlanItem[];
}

export function addPlanItem(planId: string, promptId: string): PlanItem {
  const db = getDb();
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
    `SELECT pi.*, p.title as prompt_title, p.content as prompt_content, p.working_directory as prompt_working_directory
     FROM plan_items pi
     LEFT JOIN prompts p ON pi.prompt_id = p.id
     WHERE pi.id = ?`
  ).get(id) as PlanItem;
}

export function removePlanItem(planItemId: string): boolean {
  const db = getDb();
  const item = db.prepare('SELECT * FROM plan_items WHERE id = ?').get(planItemId) as PlanItem | undefined;
  if (!item) return false;

  const transaction = db.transaction(() => {
    db.prepare('DELETE FROM plan_items WHERE id = ?').run(planItemId);

    const remaining = db.prepare(
      'SELECT id FROM plan_items WHERE plan_id = ? ORDER BY item_order ASC'
    ).all(item.plan_id) as Array<{ id: string }>;

    const stmt = db.prepare('UPDATE plan_items SET item_order = ? WHERE id = ?');
    for (let i = 0; i < remaining.length; i++) {
      stmt.run(i, remaining[i].id);
    }
  });
  transaction();

  return true;
}

export function reorderPlanItems(planId: string, orderedItemIds: string[]): void {
  const db = getDb();
  const stmt = db.prepare('UPDATE plan_items SET item_order = ? WHERE id = ? AND plan_id = ?');

  const transaction = db.transaction(() => {
    for (let i = 0; i < orderedItemIds.length; i++) {
      stmt.run(i, orderedItemIds[i], planId);
    }
  });
  transaction();
}

// --- Plan Item Run helpers ---

export function createPlanItemRuns(sessionId: string, planId: string, startFromItemOrder?: number): PlanItemRun[] {
  const db = getDb();
  const items = getPlanItems(planId);
  const now = new Date().toISOString();

  const stmt = db.prepare(
    'INSERT INTO plan_item_runs (id, run_session_id, plan_item_id, prompt_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );

  const transaction = db.transaction(() => {
    for (const item of items) {
      const status = (startFromItemOrder !== undefined && item.item_order < startFromItemOrder) ? 'skipped' : 'pending';
      stmt.run(uuidv4(), sessionId, item.id, item.prompt_id, status, now, now);
    }
  });
  transaction();

  return getPlanItemRuns(sessionId);
}

export function getPlanItemRuns(sessionId: string): PlanItemRun[] {
  const db = getDb();
  return db.prepare(
    `SELECT pir.*, p.title as prompt_title, pi.item_order
     FROM plan_item_runs pir
     LEFT JOIN prompts p ON pir.prompt_id = p.id
     LEFT JOIN plan_items pi ON pir.plan_item_id = pi.id
     WHERE pir.run_session_id = ?
     ORDER BY pi.item_order ASC`
  ).all(sessionId) as PlanItemRun[];
}

export function getNextPendingPlanItemRun(sessionId: string): PlanItemRun | undefined {
  const db = getDb();
  return db.prepare(
    `SELECT pir.*, p.title as prompt_title, pi.item_order
     FROM plan_item_runs pir
     LEFT JOIN prompts p ON pir.prompt_id = p.id
     LEFT JOIN plan_items pi ON pir.plan_item_id = pi.id
     WHERE pir.run_session_id = ? AND pir.status = 'pending'
     ORDER BY pi.item_order ASC
     LIMIT 1`
  ).get(sessionId) as PlanItemRun | undefined;
}

export function updatePlanItemRun(id: string, data: { status: string }): PlanItemRun | undefined {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    'UPDATE plan_item_runs SET status = ?, updated_at = ? WHERE id = ?'
  ).run(data.status, now, id);

  return db.prepare(
    `SELECT pir.*, p.title as prompt_title, pi.item_order
     FROM plan_item_runs pir
     LEFT JOIN prompts p ON pir.prompt_id = p.id
     LEFT JOIN plan_items pi ON pir.plan_item_id = pi.id
     WHERE pir.id = ?`
  ).get(id) as PlanItemRun | undefined;
}

// ── Chat Functions ──

export function createChatSession(id: string, claudeSessionId: string, workingDirectory: string, model?: string): void {
  getDb().prepare(
    'INSERT INTO chat_sessions (id, claude_session_id, working_directory, model) VALUES (?, ?, ?, ?)'
  ).run(id, claudeSessionId, workingDirectory, model || null);
}

export function getChatSession(id: string): ChatSession | undefined {
  return getDb().prepare('SELECT * FROM chat_sessions WHERE id = ?').get(id) as ChatSession | undefined;
}

export function getChatSessions(): ChatSession[] {
  return getDb().prepare('SELECT * FROM chat_sessions ORDER BY updated_at DESC').all() as ChatSession[];
}

export function updateChatSession(id: string, updates: Partial<Pick<ChatSession, 'title' | 'status' | 'total_cost_usd' | 'message_count'>>): void {
  const ALLOWED_FIELDS = new Set(['title', 'status', 'total_cost_usd', 'message_count']);
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(updates)) {
    if (!ALLOWED_FIELDS.has(key)) continue;
    fields.push(`${key} = ?`);
    values.push(value);
  }
  fields.push("updated_at = datetime('now')");
  values.push(id);
  getDb().prepare(`UPDATE chat_sessions SET ${fields.join(', ')} WHERE id = ?`).run(...values);
}

export function deleteChatSession(id: string): void {
  getDb().prepare('DELETE FROM chat_sessions WHERE id = ?').run(id);
}

export function createChatMessage(id: string, sessionId: string, role: 'user' | 'assistant', content: string, costUsd?: number, durationMs?: number): void {
  getDb().prepare(
    'INSERT INTO chat_messages (id, session_id, role, content, cost_usd, duration_ms) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, sessionId, role, content, costUsd ?? null, durationMs ?? null);
  // Update session message count and cost
  const updateFields = ['message_count = message_count + 1', "updated_at = datetime('now')"];
  const updateValues: unknown[] = [];
  if (costUsd != null && costUsd > 0) {
    updateFields.push('total_cost_usd = total_cost_usd + ?');
    updateValues.push(costUsd);
  }
  updateValues.push(sessionId);
  getDb().prepare(`UPDATE chat_sessions SET ${updateFields.join(', ')} WHERE id = ?`).run(...updateValues);
}

export function getChatMessages(sessionId: string, limit = 100, offset = 0): ChatMessage[] {
  return getDb().prepare(
    'SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC LIMIT ? OFFSET ?'
  ).all(sessionId, limit, offset) as ChatMessage[];
}
