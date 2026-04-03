import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

const TEST_DB_PATH = path.join(process.cwd(), 'test-autonomous.db');

let db: Database.Database;

// --- Types mirroring src/lib/autonomous/types.ts ---

interface AutoSession {
  id: string;
  target_project: string;
  status: string;
  total_cycles: number;
  total_cost_usd: number;
  config: string | null;
  initial_prompt: string | null;
  created_at: string;
  updated_at: string;
}

interface AutoUserPrompt {
  id: string;
  session_id: string;
  content: string;
  added_at_cycle: number;
  created_at: string;
}

interface AutoAgent {
  id: string;
  name: string;
  display_name: string;
  role_description: string;
  system_prompt: string;
  pipeline_order: number;
  enabled: number;
  is_builtin: number;
  created_at: string;
  updated_at: string;
}

interface AutoAgentRun {
  id: string;
  cycle_id: string;
  agent_id: string;
  agent_name: string;
  iteration: number;
  status: string;
  prompt: string;
  output: string;
  cost_usd: number | null;
  duration_ms: number | null;
  started_at: string;
  completed_at: string | null;
}

interface AutoCycle {
  id: string;
  session_id: string;
  cycle_number: number;
  phase: string;
  status: string;
  finding_id: string | null;
  prompt_used: string | null;
  output: string;
  cost_usd: number | null;
  duration_ms: number | null;
  git_checkpoint: string | null;
  test_pass_count: number | null;
  test_fail_count: number | null;
  test_total_count: number | null;
  started_at: string;
  completed_at: string | null;
}

interface AutoSettings {
  target_project: string;
  test_command: string;
  max_cycles: number;
  auto_commit: boolean;
  branch_name: string;
  max_retries: number;
  max_consecutive_failures: number;
  review_max_iterations: number;
  skip_designer_for_fixes: boolean;
  require_initial_prompt: boolean;
}

// --- seedBuiltinAgents (mirrors seed-agents.ts) ---

interface AgentSeed {
  name: string;
  display_name: string;
  role_description: string;
  system_prompt: string;
  pipeline_order: number;
}

const BUILTIN_AGENTS: AgentSeed[] = [
  {
    name: 'product_designer',
    display_name: 'Product Designer',
    role_description: 'Defines feature specs, UX flows, and acceptance criteria',
    system_prompt: 'Product Designer system prompt',
    pipeline_order: 1,
  },
  {
    name: 'developer',
    display_name: 'Developer',
    role_description: 'Implements code based on feature specs',
    system_prompt: 'Developer system prompt',
    pipeline_order: 2,
  },
  {
    name: 'reviewer',
    display_name: 'Reviewer',
    role_description: 'Reviews code quality, bugs, and design consistency',
    system_prompt: 'Reviewer system prompt',
    pipeline_order: 3,
  },
  {
    name: 'qa_engineer',
    display_name: 'QA Engineer',
    role_description: 'Runs tests and validates feature acceptance criteria',
    system_prompt: 'QA Engineer system prompt',
    pipeline_order: 4,
  },
];

function seedBuiltinAgents(database: Database.Database): void {
  const now = new Date().toISOString();
  const stmt = database.prepare(`
    INSERT OR IGNORE INTO auto_agents
    (id, name, display_name, role_description, system_prompt, pipeline_order, enabled, is_builtin, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?, ?)
  `);

  for (const agent of BUILTIN_AGENTS) {
    stmt.run(
      `builtin-${agent.name}`,
      agent.name,
      agent.display_name,
      agent.role_description,
      agent.system_prompt,
      agent.pipeline_order,
      now,
      now
    );
  }
}

// --- Init test DB (mirrors initAutoTables in db.ts) ---

function initTestDb(): Database.Database {
  try { fs.unlinkSync(TEST_DB_PATH); } catch { /* ignore */ }
  try { fs.unlinkSync(TEST_DB_PATH + '-wal'); } catch { /* ignore */ }
  try { fs.unlinkSync(TEST_DB_PATH + '-shm'); } catch { /* ignore */ }

  const d = new Database(TEST_DB_PATH);
  d.pragma('journal_mode = WAL');
  d.pragma('foreign_keys = ON');

  d.exec(`
    CREATE TABLE IF NOT EXISTS auto_sessions (
      id TEXT PRIMARY KEY,
      target_project TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      total_cycles INTEGER NOT NULL DEFAULT 0,
      total_cost_usd REAL NOT NULL DEFAULT 0,
      config TEXT,
      initial_prompt TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS auto_cycles (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      cycle_number INTEGER NOT NULL,
      phase TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      finding_id TEXT,
      prompt_used TEXT,
      output TEXT NOT NULL DEFAULT '',
      cost_usd REAL,
      duration_ms INTEGER,
      git_checkpoint TEXT,
      test_pass_count INTEGER,
      test_fail_count INTEGER,
      test_total_count INTEGER,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      FOREIGN KEY (session_id) REFERENCES auto_sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS auto_findings (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      category TEXT NOT NULL,
      priority TEXT NOT NULL DEFAULT 'P2',
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      file_path TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      retry_count INTEGER NOT NULL DEFAULT 0,
      max_retries INTEGER NOT NULL DEFAULT 3,
      resolved_by_cycle_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES auto_sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS auto_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS auto_user_prompts (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      content TEXT NOT NULL,
      added_at_cycle INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES auto_sessions(id) ON DELETE CASCADE
    );

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

    CREATE TABLE IF NOT EXISTS auto_agent_runs (
      id TEXT PRIMARY KEY,
      cycle_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      agent_name TEXT NOT NULL,
      iteration INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'running',
      prompt TEXT NOT NULL,
      output TEXT NOT NULL DEFAULT '',
      cost_usd REAL,
      duration_ms INTEGER,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      FOREIGN KEY (cycle_id) REFERENCES auto_cycles(id) ON DELETE CASCADE,
      FOREIGN KEY (agent_id) REFERENCES auto_agents(id)
    );
  `);

  seedBuiltinAgents(d);

  const insertSetting = d.prepare('INSERT OR IGNORE INTO auto_settings (key, value) VALUES (?, ?)');
  insertSetting.run('target_project', '');
  insertSetting.run('test_command', 'npm test');
  insertSetting.run('max_cycles', '0');
  insertSetting.run('auto_commit', 'true');
  insertSetting.run('branch_name', 'auto/improvements');
  insertSetting.run('max_retries', '3');
  insertSetting.run('max_consecutive_failures', '5');
  insertSetting.run('review_max_iterations', '2');
  insertSetting.run('skip_designer_for_fixes', 'true');
  insertSetting.run('require_initial_prompt', 'false');

  return d;
}

// --- Helper functions mirroring autonomous/db.ts ---

function createAutoSession(targetProject: string, config?: Record<string, unknown>, initialPrompt?: string): AutoSession {
  const id = uuidv4();
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO auto_sessions (id, target_project, status, total_cycles, total_cost_usd, config, initial_prompt, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, targetProject, 'running', 0, 0, config ? JSON.stringify(config) : null, initialPrompt ?? null, now, now);
  return db.prepare('SELECT * FROM auto_sessions WHERE id = ?').get(id) as AutoSession;
}


function createAutoCycle(data: { session_id: string; cycle_number: number; phase: string }): AutoCycle {
  const id = uuidv4();
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO auto_cycles (id, session_id, cycle_number, phase, status, output, started_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(id, data.session_id, data.cycle_number, data.phase, 'running', '', now);
  return db.prepare('SELECT * FROM auto_cycles WHERE id = ?').get(id) as AutoCycle;
}

// User Prompts CRUD

function createAutoUserPrompt(data: { session_id: string; content: string; added_at_cycle: number }): AutoUserPrompt {
  const id = uuidv4();
  const now = new Date().toISOString();
  db.prepare('INSERT INTO auto_user_prompts (id, session_id, content, added_at_cycle, created_at) VALUES (?, ?, ?, ?, ?)').run(id, data.session_id, data.content, data.added_at_cycle, now);
  return db.prepare('SELECT * FROM auto_user_prompts WHERE id = ?').get(id) as AutoUserPrompt;
}

function getAutoUserPrompts(sessionId: string): AutoUserPrompt[] {
  return db.prepare('SELECT * FROM auto_user_prompts WHERE session_id = ? ORDER BY created_at ASC').all(sessionId) as AutoUserPrompt[];
}

function deleteAutoUserPrompt(id: string): boolean {
  const result = db.prepare('DELETE FROM auto_user_prompts WHERE id = ?').run(id);
  return result.changes > 0;
}

// Agents CRUD

function getAutoAgents(enabledOnly?: boolean): AutoAgent[] {
  if (enabledOnly) {
    return db.prepare('SELECT * FROM auto_agents WHERE enabled = 1 ORDER BY pipeline_order ASC').all() as AutoAgent[];
  }
  return db.prepare('SELECT * FROM auto_agents ORDER BY pipeline_order ASC').all() as AutoAgent[];
}

function getAutoAgent(id: string): AutoAgent | undefined {
  return db.prepare('SELECT * FROM auto_agents WHERE id = ?').get(id) as AutoAgent | undefined;
}

function createAutoAgent(data: { name: string; display_name: string; role_description: string; system_prompt: string; pipeline_order: number }): AutoAgent {
  const id = uuidv4();
  const now = new Date().toISOString();
  db.prepare('INSERT INTO auto_agents (id, name, display_name, role_description, system_prompt, pipeline_order, enabled, is_builtin, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, 0, ?, ?)').run(id, data.name, data.display_name, data.role_description, data.system_prompt, data.pipeline_order, now, now);
  return getAutoAgent(id)!;
}

function updateAutoAgent(id: string, data: Partial<Pick<AutoAgent, 'display_name' | 'role_description' | 'system_prompt' | 'pipeline_order' | 'enabled'>>): AutoAgent | undefined {
  const existing = getAutoAgent(id);
  if (!existing) return undefined;
  const now = new Date().toISOString();
  const display_name = data.display_name ?? existing.display_name;
  const role_description = data.role_description ?? existing.role_description;
  const system_prompt = data.system_prompt ?? existing.system_prompt;
  const pipeline_order = data.pipeline_order ?? existing.pipeline_order;
  const enabled = data.enabled !== undefined ? data.enabled : existing.enabled;
  db.prepare('UPDATE auto_agents SET display_name = ?, role_description = ?, system_prompt = ?, pipeline_order = ?, enabled = ?, updated_at = ? WHERE id = ?').run(display_name, role_description, system_prompt, pipeline_order, enabled, now, id);
  return getAutoAgent(id);
}

function deleteAutoAgent(id: string): boolean {
  const agent = getAutoAgent(id);
  if (!agent) return false;
  if (agent.is_builtin) return false;
  const result = db.prepare('DELETE FROM auto_agents WHERE id = ?').run(id);
  return result.changes > 0;
}

function toggleAutoAgent(id: string): AutoAgent | undefined {
  const agent = getAutoAgent(id);
  if (!agent) return undefined;
  const newEnabled = agent.enabled ? 0 : 1;
  const now = new Date().toISOString();
  db.prepare('UPDATE auto_agents SET enabled = ?, updated_at = ? WHERE id = ?').run(newEnabled, now, id);
  return getAutoAgent(id);
}

function reorderAutoAgents(orderedPairs: Array<{ id: string; pipeline_order: number }>): void {
  const stmt = db.prepare('UPDATE auto_agents SET pipeline_order = ?, updated_at = ? WHERE id = ?');
  const now = new Date().toISOString();
  const transaction = db.transaction(() => {
    for (const pair of orderedPairs) {
      stmt.run(pair.pipeline_order, now, pair.id);
    }
  });
  transaction();
}

// Agent Runs CRUD

function createAutoAgentRun(data: { cycle_id: string; agent_id: string; agent_name: string; iteration: number; prompt: string }): AutoAgentRun {
  const id = uuidv4();
  const now = new Date().toISOString();
  db.prepare('INSERT INTO auto_agent_runs (id, cycle_id, agent_id, agent_name, iteration, status, prompt, output, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, data.cycle_id, data.agent_id, data.agent_name, data.iteration, 'running', data.prompt, '', now);
  return db.prepare('SELECT * FROM auto_agent_runs WHERE id = ?').get(id) as AutoAgentRun;
}

function updateAutoAgentRun(id: string, data: Partial<Pick<AutoAgentRun, 'status' | 'output' | 'cost_usd' | 'duration_ms' | 'completed_at'>>): AutoAgentRun | undefined {
  const existing = db.prepare('SELECT * FROM auto_agent_runs WHERE id = ?').get(id) as AutoAgentRun | undefined;
  if (!existing) return undefined;
  const status = data.status ?? existing.status;
  const output = data.output ?? existing.output;
  const cost_usd = data.cost_usd !== undefined ? data.cost_usd : existing.cost_usd;
  const duration_ms = data.duration_ms !== undefined ? data.duration_ms : existing.duration_ms;
  const completed_at = data.completed_at !== undefined ? data.completed_at : existing.completed_at;
  db.prepare('UPDATE auto_agent_runs SET status = ?, output = ?, cost_usd = ?, duration_ms = ?, completed_at = ? WHERE id = ?').run(status, output, cost_usd, duration_ms, completed_at, id);
  return db.prepare('SELECT * FROM auto_agent_runs WHERE id = ?').get(id) as AutoAgentRun | undefined;
}

function getAutoAgentRunsByCycle(cycleId: string): AutoAgentRun[] {
  return db.prepare('SELECT * FROM auto_agent_runs WHERE cycle_id = ? ORDER BY started_at ASC').all(cycleId) as AutoAgentRun[];
}

function getAutoAgentRun(id: string): AutoAgentRun | undefined {
  return db.prepare('SELECT * FROM auto_agent_runs WHERE id = ?').get(id) as AutoAgentRun | undefined;
}

// Settings

function getAutoSetting(key: string): string | undefined {
  const row = db.prepare('SELECT value FROM auto_settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value;
}

function setAutoSetting(key: string, value: string): void {
  db.prepare('INSERT INTO auto_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?').run(key, value, value);
}

function getAllAutoSettings(): AutoSettings {
  return {
    target_project: getAutoSetting('target_project') ?? '',
    test_command: getAutoSetting('test_command') ?? 'npm test',
    max_cycles: Number(getAutoSetting('max_cycles') ?? '0'),
    auto_commit: getAutoSetting('auto_commit') !== 'false',
    branch_name: getAutoSetting('branch_name') ?? 'auto/improvements',
    max_retries: Number(getAutoSetting('max_retries') ?? '3'),
    max_consecutive_failures: Number(getAutoSetting('max_consecutive_failures') ?? '5'),
    review_max_iterations: Number(getAutoSetting('review_max_iterations') ?? '2'),
    skip_designer_for_fixes: getAutoSetting('skip_designer_for_fixes') !== 'false',
    require_initial_prompt: getAutoSetting('require_initial_prompt') === 'true',
  };
}

// --- Tests ---

describe('Autonomous Mode v2 Database Operations', () => {
  beforeEach(() => {
    if (db) {
      try { db.close(); } catch { /* ignore */ }
    }
    db = initTestDb();
  });

  afterAll(() => {
    if (db) {
      try { db.close(); } catch { /* ignore */ }
    }
    try { fs.unlinkSync(TEST_DB_PATH); } catch { /* ignore */ }
    try { fs.unlinkSync(TEST_DB_PATH + '-wal'); } catch { /* ignore */ }
    try { fs.unlinkSync(TEST_DB_PATH + '-shm'); } catch { /* ignore */ }
  });

  describe('Seed Built-in Agents', () => {
    it('should seed 4 built-in agents', () => {
      const agents = getAutoAgents();
      expect(agents).toHaveLength(4);
    });

    it('should have correct agent names in order', () => {
      const agents = getAutoAgents();
      expect(agents[0].name).toBe('product_designer');
      expect(agents[1].name).toBe('developer');
      expect(agents[2].name).toBe('reviewer');
      expect(agents[3].name).toBe('qa_engineer');
    });

    it('should mark all seeded agents as builtin', () => {
      const agents = getAutoAgents();
      expect(agents.every(a => a.is_builtin === 1)).toBe(true);
    });

    it('should mark all seeded agents as enabled', () => {
      const agents = getAutoAgents();
      expect(agents.every(a => a.enabled === 1)).toBe(true);
    });

    it('should have builtin- prefixed ids', () => {
      const agents = getAutoAgents();
      expect(agents.every(a => a.id.startsWith('builtin-'))).toBe(true);
    });

    it('should use INSERT OR IGNORE for idempotent seeding', () => {
      // Call seed again - should not throw or create duplicates
      seedBuiltinAgents(db);
      const agents = getAutoAgents();
      expect(agents).toHaveLength(4);
    });

    it('should have correct pipeline_order values', () => {
      const agents = getAutoAgents();
      expect(agents[0].pipeline_order).toBe(1);
      expect(agents[1].pipeline_order).toBe(2);
      expect(agents[2].pipeline_order).toBe(3);
      expect(agents[3].pipeline_order).toBe(4);
    });
  });

  describe('Session with initial_prompt', () => {
    it('should create session without initial_prompt', () => {
      const session = createAutoSession('/project');
      expect(session).toBeDefined();
      expect(session.initial_prompt).toBeNull();
    });

    it('should create session with initial_prompt', () => {
      const session = createAutoSession('/project', undefined, 'Build a login page');
      expect(session).toBeDefined();
      expect(session.initial_prompt).toBe('Build a login page');
    });

    it('should create session with config and initial_prompt', () => {
      const session = createAutoSession('/project', { key: 'value' }, 'My prompt');
      expect(session.config).toBe(JSON.stringify({ key: 'value' }));
      expect(session.initial_prompt).toBe('My prompt');
    });
  });

  describe('User Prompts CRUD', () => {
    it('should create a user prompt', () => {
      const session = createAutoSession('/project');
      const prompt = createAutoUserPrompt({
        session_id: session.id,
        content: 'Add dark mode support',
        added_at_cycle: 0,
      });
      expect(prompt).toBeDefined();
      expect(prompt.content).toBe('Add dark mode support');
      expect(prompt.added_at_cycle).toBe(0);
      expect(prompt.session_id).toBe(session.id);
    });

    it('should get user prompts by session ordered by created_at', () => {
      const session = createAutoSession('/project');
      createAutoUserPrompt({ session_id: session.id, content: 'First', added_at_cycle: 0 });
      createAutoUserPrompt({ session_id: session.id, content: 'Second', added_at_cycle: 1 });
      createAutoUserPrompt({ session_id: session.id, content: 'Third', added_at_cycle: 2 });

      const prompts = getAutoUserPrompts(session.id);
      expect(prompts).toHaveLength(3);
      expect(prompts[0].content).toBe('First');
      expect(prompts[1].content).toBe('Second');
      expect(prompts[2].content).toBe('Third');
    });

    it('should return empty array for session with no prompts', () => {
      const session = createAutoSession('/project');
      const prompts = getAutoUserPrompts(session.id);
      expect(prompts).toHaveLength(0);
    });

    it('should not return prompts from other sessions', () => {
      const session1 = createAutoSession('/project1');
      const session2 = createAutoSession('/project2');
      createAutoUserPrompt({ session_id: session1.id, content: 'Session 1 prompt', added_at_cycle: 0 });
      createAutoUserPrompt({ session_id: session2.id, content: 'Session 2 prompt', added_at_cycle: 0 });

      const prompts1 = getAutoUserPrompts(session1.id);
      expect(prompts1).toHaveLength(1);
      expect(prompts1[0].content).toBe('Session 1 prompt');
    });

    it('should delete a user prompt', () => {
      const session = createAutoSession('/project');
      const prompt = createAutoUserPrompt({ session_id: session.id, content: 'To delete', added_at_cycle: 0 });
      const deleted = deleteAutoUserPrompt(prompt.id);
      expect(deleted).toBe(true);
      const prompts = getAutoUserPrompts(session.id);
      expect(prompts).toHaveLength(0);
    });

    it('should return false when deleting non-existent user prompt', () => {
      const deleted = deleteAutoUserPrompt('non-existent');
      expect(deleted).toBe(false);
    });

    it('should cascade delete user prompts when session is deleted', () => {
      const session = createAutoSession('/project');
      createAutoUserPrompt({ session_id: session.id, content: 'Prompt 1', added_at_cycle: 0 });
      createAutoUserPrompt({ session_id: session.id, content: 'Prompt 2', added_at_cycle: 1 });

      db.prepare('DELETE FROM auto_sessions WHERE id = ?').run(session.id);

      const prompts = getAutoUserPrompts(session.id);
      expect(prompts).toHaveLength(0);
    });
  });

  describe('Agents CRUD', () => {
    it('should create a custom agent', () => {
      const agent = createAutoAgent({
        name: 'custom_agent',
        display_name: 'Custom Agent',
        role_description: 'Does custom things',
        system_prompt: 'You are a custom agent.',
        pipeline_order: 5,
      });
      expect(agent).toBeDefined();
      expect(agent.name).toBe('custom_agent');
      expect(agent.display_name).toBe('Custom Agent');
      expect(agent.is_builtin).toBe(0);
      expect(agent.enabled).toBe(1);
      expect(agent.pipeline_order).toBe(5);
    });

    it('should get all agents ordered by pipeline_order', () => {
      const agents = getAutoAgents();
      expect(agents.length).toBeGreaterThanOrEqual(4); // at least built-ins
      for (let i = 1; i < agents.length; i++) {
        expect(agents[i].pipeline_order).toBeGreaterThanOrEqual(agents[i - 1].pipeline_order);
      }
    });

    it('should get only enabled agents when enabledOnly is true', () => {
      const agent = createAutoAgent({
        name: 'disabled_agent',
        display_name: 'Disabled Agent',
        role_description: 'A disabled agent',
        system_prompt: 'disabled',
        pipeline_order: 10,
      });
      // Disable the agent
      updateAutoAgent(agent.id, { enabled: 0 });

      const allAgents = getAutoAgents();
      const enabledAgents = getAutoAgents(true);
      expect(enabledAgents.length).toBe(allAgents.length - 1);
      expect(enabledAgents.find(a => a.id === agent.id)).toBeUndefined();
    });

    it('should get agent by id', () => {
      const agent = getAutoAgent('builtin-developer');
      expect(agent).toBeDefined();
      expect(agent!.name).toBe('developer');
    });

    it('should return undefined for non-existent agent', () => {
      const agent = getAutoAgent('non-existent');
      expect(agent).toBeUndefined();
    });

    it('should update agent display_name', () => {
      const updated = updateAutoAgent('builtin-developer', { display_name: 'Senior Dev' });
      expect(updated).toBeDefined();
      expect(updated!.display_name).toBe('Senior Dev');
    });

    it('should update agent system_prompt', () => {
      const updated = updateAutoAgent('builtin-reviewer', { system_prompt: 'New prompt' });
      expect(updated).toBeDefined();
      expect(updated!.system_prompt).toBe('New prompt');
    });

    it('should update agent enabled status', () => {
      const updated = updateAutoAgent('builtin-qa_engineer', { enabled: 0 });
      expect(updated).toBeDefined();
      expect(updated!.enabled).toBe(0);
    });

    it('should return undefined when updating non-existent agent', () => {
      const result = updateAutoAgent('non-existent', { display_name: 'Nope' });
      expect(result).toBeUndefined();
    });

    it('should not delete built-in agents', () => {
      const deleted = deleteAutoAgent('builtin-developer');
      expect(deleted).toBe(false);
      const agent = getAutoAgent('builtin-developer');
      expect(agent).toBeDefined();
    });

    it('should delete custom agents', () => {
      const agent = createAutoAgent({
        name: 'to_delete',
        display_name: 'To Delete',
        role_description: 'Will be deleted',
        system_prompt: 'Delete me',
        pipeline_order: 99,
      });
      const deleted = deleteAutoAgent(agent.id);
      expect(deleted).toBe(true);
      expect(getAutoAgent(agent.id)).toBeUndefined();
    });

    it('should return false when deleting non-existent agent', () => {
      const deleted = deleteAutoAgent('non-existent');
      expect(deleted).toBe(false);
    });

    it('should toggle agent enabled status', () => {
      const agent = getAutoAgent('builtin-developer')!;
      expect(agent.enabled).toBe(1);

      const toggled = toggleAutoAgent('builtin-developer');
      expect(toggled).toBeDefined();
      expect(toggled!.enabled).toBe(0);

      const toggledBack = toggleAutoAgent('builtin-developer');
      expect(toggledBack).toBeDefined();
      expect(toggledBack!.enabled).toBe(1);
    });

    it('should return undefined when toggling non-existent agent', () => {
      const result = toggleAutoAgent('non-existent');
      expect(result).toBeUndefined();
    });

    it('should reorder agents', () => {
      reorderAutoAgents([
        { id: 'builtin-product_designer', pipeline_order: 4 },
        { id: 'builtin-developer', pipeline_order: 3 },
        { id: 'builtin-reviewer', pipeline_order: 2 },
        { id: 'builtin-qa_engineer', pipeline_order: 1 },
      ]);

      const agents = getAutoAgents();
      expect(agents[0].name).toBe('qa_engineer');
      expect(agents[1].name).toBe('reviewer');
      expect(agents[2].name).toBe('developer');
      expect(agents[3].name).toBe('product_designer');
    });

    it('should enforce unique name constraint', () => {
      expect(() => {
        createAutoAgent({
          name: 'product_designer', // already exists as builtin
          display_name: 'Duplicate',
          role_description: 'Dup',
          system_prompt: 'Dup',
          pipeline_order: 99,
        });
      }).toThrow();
    });
  });

  describe('Agent Runs CRUD', () => {
    let sessionId: string;
    let cycleId: string;

    beforeEach(() => {
      const session = createAutoSession('/project');
      sessionId = session.id;
      const cycle = createAutoCycle({ session_id: sessionId, cycle_number: 1, phase: 'pipeline' });
      cycleId = cycle.id;
    });

    it('should create an agent run', () => {
      const run = createAutoAgentRun({
        cycle_id: cycleId,
        agent_id: 'builtin-developer',
        agent_name: 'developer',
        iteration: 1,
        prompt: 'Implement the feature',
      });
      expect(run).toBeDefined();
      expect(run.status).toBe('running');
      expect(run.output).toBe('');
      expect(run.agent_name).toBe('developer');
      expect(run.iteration).toBe(1);
      expect(run.prompt).toBe('Implement the feature');
    });

    it('should get agent run by id', () => {
      const run = createAutoAgentRun({
        cycle_id: cycleId,
        agent_id: 'builtin-developer',
        agent_name: 'developer',
        iteration: 1,
        prompt: 'Test prompt',
      });
      const fetched = getAutoAgentRun(run.id);
      expect(fetched).toBeDefined();
      expect(fetched!.id).toBe(run.id);
    });

    it('should return undefined for non-existent agent run', () => {
      const result = getAutoAgentRun('non-existent');
      expect(result).toBeUndefined();
    });

    it('should update agent run status and output', () => {
      const run = createAutoAgentRun({
        cycle_id: cycleId,
        agent_id: 'builtin-developer',
        agent_name: 'developer',
        iteration: 1,
        prompt: 'Do work',
      });
      const now = new Date().toISOString();
      const updated = updateAutoAgentRun(run.id, {
        status: 'completed',
        output: 'Feature implemented successfully',
        cost_usd: 0.15,
        duration_ms: 45000,
        completed_at: now,
      });
      expect(updated).toBeDefined();
      expect(updated!.status).toBe('completed');
      expect(updated!.output).toBe('Feature implemented successfully');
      expect(updated!.cost_usd).toBe(0.15);
      expect(updated!.duration_ms).toBe(45000);
      expect(updated!.completed_at).toBe(now);
    });

    it('should return undefined when updating non-existent agent run', () => {
      const result = updateAutoAgentRun('non-existent', { status: 'completed' });
      expect(result).toBeUndefined();
    });

    it('should partially update agent run', () => {
      const run = createAutoAgentRun({
        cycle_id: cycleId,
        agent_id: 'builtin-developer',
        agent_name: 'developer',
        iteration: 1,
        prompt: 'Do work',
      });
      const updated = updateAutoAgentRun(run.id, { output: 'Partial output' });
      expect(updated).toBeDefined();
      expect(updated!.status).toBe('running'); // unchanged
      expect(updated!.output).toBe('Partial output');
    });

    it('should get agent runs by cycle ordered by started_at', () => {
      createAutoAgentRun({
        cycle_id: cycleId,
        agent_id: 'builtin-product_designer',
        agent_name: 'product_designer',
        iteration: 1,
        prompt: 'Design prompt',
      });
      createAutoAgentRun({
        cycle_id: cycleId,
        agent_id: 'builtin-developer',
        agent_name: 'developer',
        iteration: 1,
        prompt: 'Dev prompt',
      });
      createAutoAgentRun({
        cycle_id: cycleId,
        agent_id: 'builtin-reviewer',
        agent_name: 'reviewer',
        iteration: 1,
        prompt: 'Review prompt',
      });

      const runs = getAutoAgentRunsByCycle(cycleId);
      expect(runs).toHaveLength(3);
      expect(runs[0].agent_name).toBe('product_designer');
      expect(runs[1].agent_name).toBe('developer');
      expect(runs[2].agent_name).toBe('reviewer');
    });

    it('should return empty array for cycle with no runs', () => {
      const runs = getAutoAgentRunsByCycle('non-existent-cycle');
      expect(runs).toHaveLength(0);
    });

    it('should support multiple iterations for the same agent in a cycle', () => {
      createAutoAgentRun({
        cycle_id: cycleId,
        agent_id: 'builtin-developer',
        agent_name: 'developer',
        iteration: 1,
        prompt: 'First attempt',
      });
      createAutoAgentRun({
        cycle_id: cycleId,
        agent_id: 'builtin-developer',
        agent_name: 'developer',
        iteration: 2,
        prompt: 'Second attempt after review',
      });

      const runs = getAutoAgentRunsByCycle(cycleId);
      const devRuns = runs.filter(r => r.agent_name === 'developer');
      expect(devRuns).toHaveLength(2);
      expect(devRuns[0].iteration).toBe(1);
      expect(devRuns[1].iteration).toBe(2);
    });
  });

  describe('v2 Settings', () => {
    it('should include v2 default settings', () => {
      const settings = getAllAutoSettings();
      expect(settings.review_max_iterations).toBe(2);
      expect(settings.skip_designer_for_fixes).toBe(true);
      expect(settings.require_initial_prompt).toBe(false);
    });

    it('should update review_max_iterations', () => {
      setAutoSetting('review_max_iterations', '5');
      const settings = getAllAutoSettings();
      expect(settings.review_max_iterations).toBe(5);
    });

    it('should update skip_designer_for_fixes', () => {
      setAutoSetting('skip_designer_for_fixes', 'false');
      const settings = getAllAutoSettings();
      expect(settings.skip_designer_for_fixes).toBe(false);
    });

    it('should update require_initial_prompt', () => {
      setAutoSetting('require_initial_prompt', 'true');
      const settings = getAllAutoSettings();
      expect(settings.require_initial_prompt).toBe(true);
    });

    it('should still include all v1 settings', () => {
      const settings = getAllAutoSettings();
      expect(settings.target_project).toBe('');
      expect(settings.test_command).toBe('npm test');
      expect(settings.max_cycles).toBe(0);
      expect(settings.auto_commit).toBe(true);
      expect(settings.branch_name).toBe('auto/improvements');
      expect(settings.max_retries).toBe(3);
      expect(settings.max_consecutive_failures).toBe(5);
    });
  });
});
