import { getDb } from '../db';
import { v4 as uuidv4 } from 'uuid';
import type { AutoSession, AutoCycle, AutoFinding, AutoSettings, AutoUserPrompt, AutoAgent, AutoAgentRun, CEORequest, CEORequestType, CEORequestStatus } from './types';
import { seedBuiltinAgents } from './seed-agents';
import { initMemoryTables } from './memory-db';

const DEFAULT_GLOBAL_PROMPT = `## Autonomy & CEO Escalation Policy

You have full authority over all code changes — production, test, config, documentation. Make your own decisions and execute. Do not hesitate or ask for permission on code-level work.

### What you handle autonomously (examples)
- Fixing bugs, refactoring code, changing architecture
- Modifying test assertions, finders, timing, tearDown/setUp
- Adding/removing dependencies already available in the project
- Changing catch types, null guards, error handling
- Writing new features based on the spec provided

### When to escalate to CEO (you physically cannot do these)
- **External services**: Creating Firebase projects, obtaining API keys, purchasing paid subscriptions
- **Deployment**: App Store / Play Store submission, DNS changes, server provisioning, CI/CD pipeline setup
- **Budget**: Decisions that cost money (new SaaS tools, cloud resources, licenses)
- **External communication**: Contacting other teams, vendors, or users
- **Hardware**: Physical device setup, lab equipment

### CEO request format
When escalation is genuinely needed, include in your output:
\`\`\`json
{ "ceo_requests": [{ "type": "permission|resource|decision|information", "title": "Brief title", "description": "What you need and why", "blocking": true/false }] }
\`\`\`
- \`blocking: true\` = pause related work until CEO responds
- Do NOT escalate if you can solve it with code. When in doubt, implement your best judgment and validate with tests.`;

// --- Init ---

export function initAutoTables(): void {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS auto_sessions (
      id TEXT PRIMARY KEY,
      target_project TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      total_cycles INTEGER NOT NULL DEFAULT 0,
      total_cost_usd REAL NOT NULL DEFAULT 0,
      config TEXT,
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
  `);

  // v2 migration: add initial_prompt column
  const sessionCols = db.prepare("PRAGMA table_info(auto_sessions)").all() as Array<{ name: string }>;
  if (!sessionCols.some(c => c.name === 'initial_prompt')) {
    db.exec('ALTER TABLE auto_sessions ADD COLUMN initial_prompt TEXT');
  }

  // Migration: add failure_history column to auto_findings
  const findingCols = db.prepare("PRAGMA table_info(auto_findings)").all() as Array<{ name: string }>;
  if (!findingCols.some(c => c.name === 'failure_history')) {
    db.exec('ALTER TABLE auto_findings ADD COLUMN failure_history TEXT');
  }

  // Migration: add active_for_cycles to user prompts
  try {
    db.exec('ALTER TABLE auto_user_prompts ADD COLUMN active_for_cycles INTEGER DEFAULT NULL');
  } catch {
    // Column already exists
  }

  // v2 tables
  db.exec(`
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

  // Performance indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_auto_findings_status_priority ON auto_findings(status, priority);
    CREATE INDEX IF NOT EXISTS idx_auto_findings_session_id ON auto_findings(session_id);
    CREATE INDEX IF NOT EXISTS idx_auto_cycles_session_id ON auto_cycles(session_id, cycle_number);
    CREATE INDEX IF NOT EXISTS idx_auto_agent_runs_cycle_id ON auto_agent_runs(cycle_id);
    CREATE INDEX IF NOT EXISTS idx_auto_sessions_created_at ON auto_sessions(created_at);
  `);

  // Seed built-in agents
  seedBuiltinAgents(db);

  // Migration: add model column to auto_agents
  try {
    db.exec("ALTER TABLE auto_agents ADD COLUMN model TEXT NOT NULL DEFAULT 'claude-opus-4-6'");
  } catch {
    // Column already exists
  }

  // Migration: add parallel_group column to auto_agents
  try {
    db.exec('ALTER TABLE auto_agents ADD COLUMN parallel_group TEXT');
  } catch {
    // Column already exists
  }

  // Re-seed to populate model for built-in agents
  seedBuiltinAgents(db);

  // Migration: add cycle scoring columns to auto_cycles
  try {
    db.exec('ALTER TABLE auto_cycles ADD COLUMN build_passed INTEGER');
  } catch {
    // Column already exists
  }
  try {
    db.exec('ALTER TABLE auto_cycles ADD COLUMN lint_passed INTEGER');
  } catch {
    // Column already exists
  }
  try {
    db.exec('ALTER TABLE auto_cycles ADD COLUMN composite_score REAL');
  } catch {
    // Column already exists
  }
  try {
    db.exec('ALTER TABLE auto_cycles ADD COLUMN score_breakdown TEXT');
  } catch {
    // Column already exists
  }

  // Migration: enforce UNIQUE(session_id, cycle_number) on auto_cycles.
  // Historically cycle_number was assigned from an in-memory counter that
  // could desync when multiple WorkerPools overlapped, producing duplicates.
  // Step 1: renumber any existing duplicates to fresh MAX+N slots (keeps
  //         the earliest row untouched, shifts the rest to the tail).
  // Step 2: create the UNIQUE index. createAutoCycle() below computes
  //         cycle_number atomically, so the constraint only catches bugs.
  try {
    const dupRows = db.prepare(`
      SELECT id, session_id, cycle_number, started_at
      FROM auto_cycles
      WHERE (session_id, cycle_number) IN (
        SELECT session_id, cycle_number
        FROM auto_cycles
        GROUP BY session_id, cycle_number
        HAVING COUNT(*) > 1
      )
      ORDER BY session_id, cycle_number, started_at ASC
    `).all() as Array<{ id: string; session_id: string; cycle_number: number; started_at: string }>;

    if (dupRows.length > 0) {
      const grouped = new Map<string, typeof dupRows>();
      for (const r of dupRows) {
        const key = `${r.session_id}:${r.cycle_number}`;
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key)!.push(r);
      }
      const maxStmt = db.prepare(
        'SELECT COALESCE(MAX(cycle_number), -1) + 1 AS next FROM auto_cycles WHERE session_id = ?',
      );
      const updateStmt = db.prepare('UPDATE auto_cycles SET cycle_number = ? WHERE id = ?');
      const dedupe = db.transaction(() => {
        for (const [key, rows] of grouped) {
          const sessionId = key.split(':')[0];
          for (let i = 1; i < rows.length; i++) {
            const next = (maxStmt.get(sessionId) as { next: number }).next;
            updateStmt.run(next, rows[i].id);
          }
        }
      });
      dedupe();
    }

    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_auto_cycles_unique ON auto_cycles(session_id, cycle_number)');
  } catch {
    // Index already exists or unexpected state; safe to ignore on migration replay
  }

  // Insert default settings if not exist
  const insertSetting = db.prepare(
    'INSERT OR IGNORE INTO auto_settings (key, value) VALUES (?, ?)'
  );
  insertSetting.run('target_project', '');
  insertSetting.run('test_command', 'npm test');
  insertSetting.run('max_cycles', '0');
  insertSetting.run('auto_commit', 'true');
  insertSetting.run('branch_name', 'auto/improvements');
  insertSetting.run('max_retries', '3');
  insertSetting.run('max_consecutive_failures', '5');
  // v2 settings
  insertSetting.run('review_max_iterations', '2');
  insertSetting.run('skip_designer_for_fixes', 'true');
  insertSetting.run('require_initial_prompt', 'false');
  insertSetting.run('max_designer_iterations', '2');
  // v3 settings: generic evaluation commands
  insertSetting.run('build_command', '');
  insertSetting.run('lint_command', '');
  // v5 settings: screen capture
  insertSetting.run('screenshot_dir', '');
  // v7 settings: global prompt for all agents
  insertSetting.run('global_prompt', '');
  // v9: migrate CEO escalation from per-agent to global prompt
  {
    const current = db.prepare("SELECT value FROM auto_settings WHERE key = 'global_prompt'").get() as { value: string } | undefined;
    if (current && !current.value) {
      db.prepare("UPDATE auto_settings SET value = ? WHERE key = 'global_prompt'").run(DEFAULT_GLOBAL_PROMPT);
    }
  }
  // v8 settings: parallel finding processing
  insertSetting.run('parallel_mode', 'false');
  insertSetting.run('max_parallel_pipelines', '3');
  // v10: Memory settings
  insertSetting.run('memory_enabled', 'true');
  insertSetting.run('knowledge_extraction_interval', '5');
  insertSetting.run('max_knowledge_context_chars', '3500');

  // v10: Memory tables
  initMemoryTables();

  // v10: Add project_path to findings for cross-session queries
  try {
    db.exec('ALTER TABLE auto_findings ADD COLUMN project_path TEXT');
    // Backfill from sessions
    db.exec(`UPDATE auto_findings SET project_path = (
      SELECT target_project FROM auto_sessions WHERE auto_sessions.id = auto_findings.session_id
    ) WHERE project_path IS NULL`);
  } catch { /* Column already exists */ }

  // v10: Add resolution_summary to findings
  try {
    db.exec('ALTER TABLE auto_findings ADD COLUMN resolution_summary TEXT');
  } catch { /* Column already exists */ }

  // v11: Add epic support to findings
  try {
    db.exec('ALTER TABLE auto_findings ADD COLUMN epic_id TEXT');
  } catch { /* Column already exists */ }
  try {
    db.exec('ALTER TABLE auto_findings ADD COLUMN epic_order INTEGER');
  } catch { /* Column already exists */ }
  db.exec('CREATE INDEX IF NOT EXISTS idx_auto_findings_epic_id ON auto_findings(epic_id)');

  // v13: Add prd_path to findings
  try {
    db.exec('ALTER TABLE auto_findings ADD COLUMN prd_path TEXT');
  } catch { /* Column already exists */ }

  // v6: CEO escalation requests table
  db.exec(`
    CREATE TABLE IF NOT EXISTS auto_ceo_requests (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      cycle_id TEXT,
      from_agent TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'information',
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      metadata TEXT,
      blocking INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      ceo_response TEXT,
      created_at TEXT NOT NULL,
      responded_at TEXT,
      FOREIGN KEY (session_id) REFERENCES auto_sessions(id) ON DELETE CASCADE
    );
  `);

  // v12: Add metadata column to CEO requests (for deferred finding blueprints)
  try {
    db.exec('ALTER TABLE auto_ceo_requests ADD COLUMN metadata TEXT');
  } catch { /* Column already exists */ }

  // v14: Add exit_code column to auto_agent_runs for post-mortem analysis
  try {
    db.exec('ALTER TABLE auto_agent_runs ADD COLUMN exit_code INTEGER');
  } catch { /* Column already exists */ }

}

let crashRecoveryDone = false;

/**
 * Run crash recovery once per process lifetime.
 * Separated from initAutoTables() to prevent HMR re-imports from
 * killing actively running sessions.
 */
export function runCrashRecoveryOnce(): void {
  if (crashRecoveryDone) return;
  crashRecoveryDone = true;
  const recovered = recoverOrphanedStates();
  if (recovered.total > 0) {
    console.log(`[auto] Crash recovery: fixed ${recovered.sessions} sessions, ${recovered.cycles} cycles, ${recovered.agentRuns} agent runs, ${recovered.findings} findings`);
  }
}

function recoverOrphanedStates(): { sessions: number; cycles: number; agentRuns: number; findings: number; total: number } {
  const db = getDb();
  const now = new Date().toISOString();

  const sessions = db.prepare(
    "UPDATE auto_sessions SET status = 'stopped', updated_at = ? WHERE status = 'running'"
  ).run(now).changes;

  const cycles = db.prepare(
    "UPDATE auto_cycles SET status = 'failed', completed_at = ? WHERE status = 'running'"
  ).run(now).changes;

  const agentRuns = db.prepare(
    "UPDATE auto_agent_runs SET status = 'failed', completed_at = ? WHERE status = 'running'"
  ).run(now).changes;

  const findings = db.prepare(
    "UPDATE auto_findings SET status = 'open', updated_at = ? WHERE status = 'in_progress'"
  ).run(now).changes;

  return { sessions, cycles, agentRuns, findings, total: sessions + cycles + agentRuns + findings };
}

// Initialize tables on first import
initAutoTables();

// --- Session CRUD ---

export function createAutoSession(targetProject: string, config?: Record<string, unknown>, initialPrompt?: string): AutoSession {
  const db = getDb();
  const id = uuidv4();
  const now = new Date().toISOString();

  db.prepare(
    'INSERT INTO auto_sessions (id, target_project, status, total_cycles, total_cost_usd, config, initial_prompt, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, targetProject, 'running', 0, 0, config ? JSON.stringify(config) : null, initialPrompt ?? null, now, now);

  return getAutoSession(id)!;
}

export function getAutoSession(id: string): AutoSession | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM auto_sessions WHERE id = ?').get(id) as AutoSession | undefined;
}

export function updateAutoSession(id: string, data: Partial<Pick<AutoSession, 'status' | 'total_cycles' | 'total_cost_usd' | 'config'>>): AutoSession | undefined {
  const db = getDb();
  const existing = getAutoSession(id);
  if (!existing) return undefined;

  const now = new Date().toISOString();
  const status = data.status ?? existing.status;
  const totalCycles = data.total_cycles !== undefined ? data.total_cycles : existing.total_cycles;
  const totalCostUsd = data.total_cost_usd !== undefined ? data.total_cost_usd : existing.total_cost_usd;
  const config = data.config !== undefined ? data.config : existing.config;

  db.prepare(
    'UPDATE auto_sessions SET status = ?, total_cycles = ?, total_cost_usd = ?, config = ?, updated_at = ? WHERE id = ?'
  ).run(status, totalCycles, totalCostUsd, config, now, id);

  return getAutoSession(id);
}

export function getAutoSessions(limit: number = 20, offset: number = 0): AutoSession[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM auto_sessions ORDER BY created_at DESC LIMIT ? OFFSET ?'
  ).all(limit, offset) as AutoSession[];
}

export function getLatestAutoSession(): AutoSession | undefined {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM auto_sessions ORDER BY created_at DESC LIMIT 1'
  ).get() as AutoSession | undefined;
}

// --- Cycle CRUD ---

export function createAutoCycle(data: {
  session_id: string;
  /**
   * Optional. Omit to let the DB assign the next per-session cycle_number
   * atomically (MAX+1 inside a transaction). Pass explicitly only for tests
   * that need a specific value; if the (session_id, cycle_number) pair
   * already exists the UNIQUE index will reject the insert.
   */
  cycle_number?: number;
  phase: string;
  finding_id?: string | null;
  prompt_used?: string | null;
  git_checkpoint?: string | null;
}): AutoCycle {
  const db = getDb();
  const id = uuidv4();
  const now = new Date().toISOString();

  const txn = db.transaction(() => {
    let cycleNumber = data.cycle_number;
    if (cycleNumber === undefined) {
      const row = db.prepare(
        'SELECT COALESCE(MAX(cycle_number), -1) + 1 AS next FROM auto_cycles WHERE session_id = ?',
      ).get(data.session_id) as { next: number };
      cycleNumber = row.next;
    }
    db.prepare(
      'INSERT INTO auto_cycles (id, session_id, cycle_number, phase, status, finding_id, prompt_used, output, git_checkpoint, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(id, data.session_id, cycleNumber, data.phase, 'running', data.finding_id ?? null, data.prompt_used ?? null, '', data.git_checkpoint ?? null, now);
  });

  txn();
  return getAutoCycle(id)!;
}

export function getAutoCycle(id: string): AutoCycle | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM auto_cycles WHERE id = ?').get(id) as AutoCycle | undefined;
}

export function updateAutoCycle(id: string, data: Partial<Pick<AutoCycle, 'status' | 'output' | 'cost_usd' | 'duration_ms' | 'completed_at' | 'test_pass_count' | 'test_fail_count' | 'test_total_count' | 'build_passed' | 'lint_passed' | 'composite_score' | 'score_breakdown'>>): AutoCycle | undefined {
  const db = getDb();
  const existing = getAutoCycle(id);
  if (!existing) return undefined;

  const status = data.status ?? existing.status;
  const output = data.output ?? existing.output;
  // Cap output at 50KB to prevent unbounded growth
  const MAX_OUTPUT_SIZE = 50_000;
  const cappedOutput = output.length > MAX_OUTPUT_SIZE
    ? '...(truncated)...\n' + output.slice(-MAX_OUTPUT_SIZE)
    : output;
  const costUsd = data.cost_usd !== undefined ? data.cost_usd : existing.cost_usd;
  const durationMs = data.duration_ms !== undefined ? data.duration_ms : existing.duration_ms;
  const completedAt = data.completed_at !== undefined ? data.completed_at : existing.completed_at;
  const testPassCount = data.test_pass_count !== undefined ? data.test_pass_count : existing.test_pass_count;
  const testFailCount = data.test_fail_count !== undefined ? data.test_fail_count : existing.test_fail_count;
  const testTotalCount = data.test_total_count !== undefined ? data.test_total_count : existing.test_total_count;
  const buildPassed = data.build_passed !== undefined ? data.build_passed : existing.build_passed;
  const lintPassed = data.lint_passed !== undefined ? data.lint_passed : existing.lint_passed;
  const compositeScore = data.composite_score !== undefined ? data.composite_score : existing.composite_score;
  const scoreBreakdown = data.score_breakdown !== undefined ? data.score_breakdown : existing.score_breakdown;

  db.prepare(
    'UPDATE auto_cycles SET status = ?, output = ?, cost_usd = ?, duration_ms = ?, completed_at = ?, test_pass_count = ?, test_fail_count = ?, test_total_count = ?, build_passed = ?, lint_passed = ?, composite_score = ?, score_breakdown = ? WHERE id = ?'
  ).run(status, cappedOutput, costUsd, durationMs, completedAt, testPassCount, testFailCount, testTotalCount, buildPassed, lintPassed, compositeScore, scoreBreakdown, id);

  return getAutoCycle(id);
}

export function getAutoCyclesBySession(sessionId: string, limit: number = 100, offset: number = 0): AutoCycle[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM auto_cycles WHERE session_id = ? ORDER BY cycle_number ASC LIMIT ? OFFSET ?'
  ).all(sessionId, limit, offset) as AutoCycle[];
}

// --- Finding CRUD ---

export function createAutoFinding(data: {
  session_id: string;
  category: string;
  priority?: string;
  title: string;
  description: string;
  file_path?: string | null;
  max_retries?: number;
  project_path?: string;
  epic_id?: string | null;
  epic_order?: number | null;
  prd_path?: string | null;
}): AutoFinding {
  const db = getDb();
  const id = uuidv4();
  const now = new Date().toISOString();

  // Resolve project_path: use provided value, or look up from session
  let projectPath = data.project_path ?? null;
  if (!projectPath) {
    const session = db.prepare('SELECT target_project FROM auto_sessions WHERE id = ?').get(data.session_id) as { target_project: string } | undefined;
    projectPath = session?.target_project ?? null;
  }

  db.prepare(
    'INSERT INTO auto_findings (id, session_id, category, priority, title, description, file_path, status, retry_count, max_retries, project_path, epic_id, epic_order, prd_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, data.session_id, data.category, data.priority ?? 'P2', data.title, data.description, data.file_path ?? null, 'open', 0, data.max_retries ?? 3, projectPath, data.epic_id ?? null, data.epic_order ?? null, data.prd_path ?? null, now, now);

  return getAutoFinding(id)!;
}

export function getAutoFinding(id: string): AutoFinding | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM auto_findings WHERE id = ?').get(id) as AutoFinding | undefined;
}

export function updateAutoFinding(id: string, data: Partial<Pick<AutoFinding, 'status' | 'priority' | 'retry_count' | 'resolved_by_cycle_id' | 'description' | 'failure_history' | 'resolution_summary'>>): AutoFinding | undefined {
  const db = getDb();
  const existing = getAutoFinding(id);
  if (!existing) return undefined;

  const now = new Date().toISOString();
  const status = data.status ?? existing.status;
  const priority = data.priority ?? existing.priority;
  const retryCount = data.retry_count !== undefined ? data.retry_count : existing.retry_count;
  const resolvedByCycleId = data.resolved_by_cycle_id !== undefined ? data.resolved_by_cycle_id : existing.resolved_by_cycle_id;
  const description = data.description ?? existing.description;
  const failureHistory = data.failure_history !== undefined ? data.failure_history : (existing.failure_history ?? null);
  const resolutionSummary = data.resolution_summary !== undefined ? data.resolution_summary : (existing.resolution_summary ?? null);

  db.prepare(
    'UPDATE auto_findings SET status = ?, priority = ?, retry_count = ?, resolved_by_cycle_id = ?, description = ?, failure_history = ?, resolution_summary = ?, updated_at = ? WHERE id = ?'
  ).run(status, priority, retryCount, resolvedByCycleId, description, failureHistory, resolutionSummary, now, id);

  return getAutoFinding(id);
}

export function deleteAutoFinding(id: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM auto_findings WHERE id = ?').run(id);
  return result.changes > 0;
}

export function getAutoFindings(
  filters?: { status?: string; priority?: string; category?: string; session_id?: string },
  limit: number = 100,
  offset: number = 0
): AutoFinding[] {
  const db = getDb();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters?.status) {
    conditions.push('status = ?');
    params.push(filters.status);
  }
  if (filters?.priority) {
    conditions.push('priority = ?');
    params.push(filters.priority);
  }
  if (filters?.category) {
    conditions.push('category = ?');
    params.push(filters.category);
  }
  if (filters?.session_id) {
    conditions.push('session_id = ?');
    params.push(filters.session_id);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(limit, offset);

  return db.prepare(
    `SELECT * FROM auto_findings ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`
  ).all(...params) as AutoFinding[];
}

export function getAutoFindingCounts(sessionId: string): { total: number; open: number; resolved: number } {
  const db = getDb();
  const row = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status IN ('open', 'in_progress') THEN 1 ELSE 0 END) as open,
      SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) as resolved
    FROM auto_findings WHERE session_id = ?
  `).get(sessionId) as { total: number; open: number; resolved: number };
  return {
    total: row.total ?? 0,
    open: row.open ?? 0,
    resolved: row.resolved ?? 0,
  };
}

export function getOpenAutoFindings(): AutoFinding[] {
  const db = getDb();
  // Prioritize in-progress epics: if an epic has resolved siblings, pick the next sub-finding first
  return db.prepare(`
    SELECT f.*,
      CASE
        WHEN f.epic_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM auto_findings sib
          WHERE sib.epic_id = f.epic_id AND sib.status = 'resolved'
        ) THEN 0
        ELSE 1
      END AS epic_priority
    FROM auto_findings f
    WHERE f.status = 'open'
    ORDER BY epic_priority ASC, f.epic_order ASC, f.priority ASC, f.created_at ASC
  `).all() as AutoFinding[];
}

/**
 * Atomically pick and claim the next actionable finding.
 * Uses a SQLite transaction to prevent multiple workers from picking the same finding.
 * Prioritizes in-progress epics (epics that have some resolved sub-findings).
 */
export function pickAndClaimNextFinding(): AutoFinding | null {
  const db = getDb();
  const txn = db.transaction(() => {
    const finding = db.prepare(`
      SELECT f.*,
        CASE
          WHEN f.epic_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM auto_findings sib
            WHERE sib.epic_id = f.epic_id AND sib.status = 'resolved'
          ) THEN 0
          ELSE 1
        END AS epic_priority
      FROM auto_findings f
      WHERE f.status = 'open' AND f.retry_count < f.max_retries
      ORDER BY epic_priority ASC, f.epic_order ASC, f.priority ASC, f.created_at ASC
      LIMIT 1
    `).get() as AutoFinding | undefined;
    if (!finding) return null;
    const now = new Date().toISOString();
    db.prepare(
      "UPDATE auto_findings SET status = 'in_progress', updated_at = ? WHERE id = ?"
    ).run(now, finding.id);
    return { ...finding, status: 'in_progress' as const, updated_at: now };
  });
  return txn();
}

/**
 * Get all sub-findings for an epic, ordered by epic_order.
 */
export function getEpicFindings(epicId: string): AutoFinding[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM auto_findings WHERE epic_id = ? ORDER BY epic_order ASC'
  ).all(epicId) as AutoFinding[];
}

// --- Settings ---

export function getAutoSetting(key: string): string | undefined {
  const db = getDb();
  const row = db.prepare('SELECT value FROM auto_settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value;
}

export function setAutoSetting(key: string, value: string): void {
  const db = getDb();
  db.prepare(
    'INSERT INTO auto_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?'
  ).run(key, value, value);
}

export function getAllAutoSettings(): AutoSettings {
  return {
    target_project: getAutoSetting('target_project') ?? '',
    test_command: getAutoSetting('test_command') ?? 'npm test',
    build_command: getAutoSetting('build_command') ?? '',
    lint_command: getAutoSetting('lint_command') ?? '',
    max_cycles: Number(getAutoSetting('max_cycles') ?? '0'),
    auto_commit: getAutoSetting('auto_commit') !== 'false',
    branch_name: getAutoSetting('branch_name') ?? 'auto/improvements',
    max_retries: Number(getAutoSetting('max_retries') ?? '3'),
    max_consecutive_failures: Number(getAutoSetting('max_consecutive_failures') ?? '5'),
    // v2 settings
    review_max_iterations: Number(getAutoSetting('review_max_iterations') ?? '2'),
    skip_designer_for_fixes: getAutoSetting('skip_designer_for_fixes') !== 'false',
    require_initial_prompt: getAutoSetting('require_initial_prompt') === 'true',
    max_designer_iterations: Number(getAutoSetting('max_designer_iterations') ?? '2'),
    // v5 settings: screen capture
    screenshot_dir: getAutoSetting('screenshot_dir') ?? '',
    // v7 settings: global prompt
    global_prompt: getAutoSetting('global_prompt') ?? '',
    // v8 settings: parallel finding processing
    parallel_mode: getAutoSetting('parallel_mode') === 'true',
    max_parallel_pipelines: Number(getAutoSetting('max_parallel_pipelines') ?? '3'),
    // v10 settings: memory
    memory_enabled: getAutoSetting('memory_enabled') !== 'false',
    knowledge_extraction_interval: Number(getAutoSetting('knowledge_extraction_interval') ?? '5'),
    max_knowledge_context_chars: Number(getAutoSetting('max_knowledge_context_chars') ?? '3500'),
  };
}

// --- User Prompts CRUD ---

export function createAutoUserPrompt(data: { session_id: string; content: string; added_at_cycle: number; active_for_cycles?: number | null }): AutoUserPrompt {
  const db = getDb();
  const id = uuidv4();
  const now = new Date().toISOString();
  db.prepare('INSERT INTO auto_user_prompts (id, session_id, content, added_at_cycle, active_for_cycles, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, data.session_id, data.content, data.added_at_cycle, data.active_for_cycles ?? null, now);
  return db.prepare('SELECT * FROM auto_user_prompts WHERE id = ?').get(id) as AutoUserPrompt;
}

export function getAutoUserPrompts(sessionId: string): AutoUserPrompt[] {
  const db = getDb();
  return db.prepare('SELECT * FROM auto_user_prompts WHERE session_id = ? ORDER BY created_at ASC').all(sessionId) as AutoUserPrompt[];
}

export function deleteAutoUserPrompt(id: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM auto_user_prompts WHERE id = ?').run(id);
  return result.changes > 0;
}

// --- Agents CRUD ---

export function getAutoAgents(enabledOnly?: boolean): AutoAgent[] {
  const db = getDb();
  if (enabledOnly) {
    return db.prepare('SELECT * FROM auto_agents WHERE enabled = 1 ORDER BY pipeline_order ASC').all() as AutoAgent[];
  }
  return db.prepare('SELECT * FROM auto_agents ORDER BY pipeline_order ASC').all() as AutoAgent[];
}

export function getAutoAgent(id: string): AutoAgent | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM auto_agents WHERE id = ?').get(id) as AutoAgent | undefined;
}

export function createAutoAgent(data: { name: string; display_name: string; role_description: string; system_prompt: string; pipeline_order: number; model?: string; parallel_group?: string | null }): AutoAgent {
  const db = getDb();
  const id = uuidv4();
  const now = new Date().toISOString();
  const model = data.model || 'claude-opus-4-6';
  const parallelGroup = data.parallel_group ?? null;
  db.prepare('INSERT INTO auto_agents (id, name, display_name, role_description, system_prompt, pipeline_order, model, parallel_group, enabled, is_builtin, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)').run(id, data.name, data.display_name, data.role_description, data.system_prompt, data.pipeline_order, model, parallelGroup, now, now);
  return getAutoAgent(id)!;
}

export function updateAutoAgent(id: string, data: Partial<Pick<AutoAgent, 'display_name' | 'role_description' | 'system_prompt' | 'pipeline_order' | 'enabled' | 'model' | 'parallel_group'>>): AutoAgent | undefined {
  const db = getDb();
  const existing = getAutoAgent(id);
  if (!existing) return undefined;
  const now = new Date().toISOString();
  const display_name = data.display_name ?? existing.display_name;
  const role_description = data.role_description ?? existing.role_description;
  const system_prompt = data.system_prompt ?? existing.system_prompt;
  const pipeline_order = data.pipeline_order ?? existing.pipeline_order;
  const enabled = data.enabled !== undefined ? data.enabled : existing.enabled;
  const model = data.model ?? existing.model;
  const parallel_group = data.parallel_group !== undefined ? data.parallel_group : existing.parallel_group;
  db.prepare('UPDATE auto_agents SET display_name = ?, role_description = ?, system_prompt = ?, pipeline_order = ?, enabled = ?, model = ?, parallel_group = ?, updated_at = ? WHERE id = ?').run(display_name, role_description, system_prompt, pipeline_order, enabled, model, parallel_group, now, id);
  return getAutoAgent(id);
}

export function deleteAutoAgent(id: string): boolean {
  const db = getDb();
  const agent = getAutoAgent(id);
  if (!agent) return false;
  if (agent.is_builtin) return false; // Cannot delete built-in agents
  const result = db.prepare('DELETE FROM auto_agents WHERE id = ?').run(id);
  return result.changes > 0;
}

export function toggleAutoAgent(id: string): AutoAgent | undefined {
  const db = getDb();
  const agent = getAutoAgent(id);
  if (!agent) return undefined;
  const newEnabled = agent.enabled ? 0 : 1;
  const now = new Date().toISOString();
  db.prepare('UPDATE auto_agents SET enabled = ?, updated_at = ? WHERE id = ?').run(newEnabled, now, id);
  return getAutoAgent(id);
}

export function reorderAutoAgents(orderedPairs: Array<{ id: string; pipeline_order: number }>): void {
  const db = getDb();
  const stmt = db.prepare('UPDATE auto_agents SET pipeline_order = ?, updated_at = ? WHERE id = ?');
  const now = new Date().toISOString();
  const transaction = db.transaction(() => {
    for (const pair of orderedPairs) {
      stmt.run(pair.pipeline_order, now, pair.id);
    }
  });
  transaction();
}

// --- Agent Runs CRUD ---

export function createAutoAgentRun(data: { cycle_id: string; agent_id: string; agent_name: string; iteration: number; prompt: string }): AutoAgentRun {
  const db = getDb();
  const id = uuidv4();
  const now = new Date().toISOString();
  db.prepare('INSERT INTO auto_agent_runs (id, cycle_id, agent_id, agent_name, iteration, status, prompt, output, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, data.cycle_id, data.agent_id, data.agent_name, data.iteration, 'running', data.prompt, '', now);
  return db.prepare('SELECT * FROM auto_agent_runs WHERE id = ?').get(id) as AutoAgentRun;
}

export function updateAutoAgentRun(id: string, data: Partial<Pick<AutoAgentRun, 'status' | 'output' | 'cost_usd' | 'duration_ms' | 'exit_code' | 'completed_at'>>): AutoAgentRun | undefined {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM auto_agent_runs WHERE id = ?').get(id) as AutoAgentRun | undefined;
  if (!existing) return undefined;
  const status = data.status ?? existing.status;
  const output = data.output ?? existing.output;
  // Cap output at 50KB to prevent unbounded growth
  const MAX_OUTPUT_SIZE = 50_000;
  const cappedOutput = output.length > MAX_OUTPUT_SIZE
    ? '...(truncated)...\n' + output.slice(-MAX_OUTPUT_SIZE)
    : output;
  const cost_usd = data.cost_usd !== undefined ? data.cost_usd : existing.cost_usd;
  const duration_ms = data.duration_ms !== undefined ? data.duration_ms : existing.duration_ms;
  const exit_code = data.exit_code !== undefined ? data.exit_code : existing.exit_code;
  const completed_at = data.completed_at !== undefined ? data.completed_at : existing.completed_at;
  db.prepare('UPDATE auto_agent_runs SET status = ?, output = ?, cost_usd = ?, duration_ms = ?, exit_code = ?, completed_at = ? WHERE id = ?').run(status, cappedOutput, cost_usd, duration_ms, exit_code, completed_at, id);
  return db.prepare('SELECT * FROM auto_agent_runs WHERE id = ?').get(id) as AutoAgentRun | undefined;
}

export function getAutoAgentRunsByCycle(cycleId: string): AutoAgentRun[] {
  const db = getDb();
  return db.prepare('SELECT * FROM auto_agent_runs WHERE cycle_id = ? ORDER BY started_at ASC').all(cycleId) as AutoAgentRun[];
}

export function getAutoAgentRun(id: string): AutoAgentRun | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM auto_agent_runs WHERE id = ?').get(id) as AutoAgentRun | undefined;
}

// --- CEO Requests CRUD ---

export function createCEORequest(data: {
  session_id: string;
  cycle_id?: string;
  from_agent: string;
  type: CEORequestType;
  title: string;
  description: string;
  blocking?: boolean;
  metadata?: string | null;
}): CEORequest {
  const db = getDb();
  const id = uuidv4();
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO auto_ceo_requests (id, session_id, cycle_id, from_agent, type, title, description, metadata, blocking, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, data.session_id, data.cycle_id ?? null, data.from_agent, data.type, data.title, data.description, data.metadata ?? null, data.blocking ? 1 : 0, 'pending', now);
  return db.prepare('SELECT * FROM auto_ceo_requests WHERE id = ?').get(id) as CEORequest;
}

export function getCEORequests(sessionId: string): CEORequest[] {
  const db = getDb();
  return db.prepare('SELECT * FROM auto_ceo_requests WHERE session_id = ? ORDER BY created_at DESC').all(sessionId) as CEORequest[];
}

export function getCEORequest(id: string): CEORequest | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM auto_ceo_requests WHERE id = ?').get(id) as CEORequest | undefined;
}

export function respondToCEORequest(id: string, data: {
  status: CEORequestStatus;
  ceo_response: string;
}): CEORequest | undefined {
  const db = getDb();
  const existing = getCEORequest(id);
  if (!existing) return undefined;
  const now = new Date().toISOString();
  db.prepare(
    'UPDATE auto_ceo_requests SET status = ?, ceo_response = ?, responded_at = ? WHERE id = ?'
  ).run(data.status, data.ceo_response, now, id);
  return getCEORequest(id);
}

export function getPendingCEORequests(sessionId: string): CEORequest[] {
  const db = getDb();
  return db.prepare(
    "SELECT * FROM auto_ceo_requests WHERE session_id = ? AND status = 'pending' ORDER BY created_at ASC"
  ).all(sessionId) as CEORequest[];
}
