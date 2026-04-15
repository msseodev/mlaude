import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

const TEST_DB_PATH = path.join(process.cwd(), 'test-cycle-number.db');

let db: Database.Database;

function initTestDb(): Database.Database {
  try { fs.unlinkSync(TEST_DB_PATH); } catch { /* ignore */ }
  try { fs.unlinkSync(TEST_DB_PATH + '-wal'); } catch { /* ignore */ }
  try { fs.unlinkSync(TEST_DB_PATH + '-shm'); } catch { /* ignore */ }

  const d = new Database(TEST_DB_PATH);
  d.pragma('journal_mode = WAL');
  d.pragma('foreign_keys = ON');

  d.exec(`
    CREATE TABLE auto_sessions (
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

    CREATE TABLE auto_cycles (
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
      started_at TEXT NOT NULL,
      completed_at TEXT,
      FOREIGN KEY (session_id) REFERENCES auto_sessions(id) ON DELETE CASCADE
    );
  `);

  return d;
}

/**
 * Atomic cycle_number assignment helper — mirrors the production logic in
 * src/lib/autonomous/db.ts createAutoCycle(). When cycle_number is not
 * supplied, compute MAX(cycle_number)+1 inside a transaction so concurrent
 * workers get unique numbers even without an in-memory counter.
 */
function createCycleAtomic(
  d: Database.Database,
  data: { session_id: string; phase: string; cycle_number?: number },
): { id: string; cycle_number: number } {
  const id = uuidv4();
  const now = new Date().toISOString();

  const txn = d.transaction(() => {
    let cycleNumber = data.cycle_number;
    if (cycleNumber === undefined) {
      const row = d.prepare(
        'SELECT COALESCE(MAX(cycle_number), -1) + 1 AS next FROM auto_cycles WHERE session_id = ?',
      ).get(data.session_id) as { next: number };
      cycleNumber = row.next;
    }
    d.prepare(
      'INSERT INTO auto_cycles (id, session_id, cycle_number, phase, status, output, started_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(id, data.session_id, cycleNumber, data.phase, 'running', '', now);
    return cycleNumber;
  });

  const cycleNumber = txn();
  return { id, cycle_number: cycleNumber };
}

function createSession(d: Database.Database): string {
  const id = uuidv4();
  const now = new Date().toISOString();
  d.prepare(
    'INSERT INTO auto_sessions (id, target_project, status, total_cycles, total_cost_usd, config, initial_prompt, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(id, '/tmp/test', 'running', 0, 0, null, null, now, now);
  return id;
}

beforeEach(() => {
  db = initTestDb();
});

afterAll(() => {
  db?.close();
  try { fs.unlinkSync(TEST_DB_PATH); } catch { /* ignore */ }
  try { fs.unlinkSync(TEST_DB_PATH + '-wal'); } catch { /* ignore */ }
  try { fs.unlinkSync(TEST_DB_PATH + '-shm'); } catch { /* ignore */ }
});

describe('createAutoCycle atomic cycle_number assignment', () => {
  it('assigns cycle_number=0 for the first cycle of a session', () => {
    const sessionId = createSession(db);
    const cycle = createCycleAtomic(db, { session_id: sessionId, phase: 'pipeline' });
    expect(cycle.cycle_number).toBe(0);
  });

  it('assigns contiguous cycle_numbers for sequential calls', () => {
    const sessionId = createSession(db);
    const numbers = [
      createCycleAtomic(db, { session_id: sessionId, phase: 'pipeline' }).cycle_number,
      createCycleAtomic(db, { session_id: sessionId, phase: 'pipeline' }).cycle_number,
      createCycleAtomic(db, { session_id: sessionId, phase: 'pipeline' }).cycle_number,
    ];
    expect(numbers).toEqual([0, 1, 2]);
  });

  it('never produces duplicate cycle_numbers across many rapid calls', () => {
    const sessionId = createSession(db);
    const count = 50;
    const numbers = new Set<number>();
    for (let i = 0; i < count; i++) {
      const c = createCycleAtomic(db, { session_id: sessionId, phase: 'pipeline' });
      numbers.add(c.cycle_number);
    }
    expect(numbers.size).toBe(count);
  });

  it('scopes cycle_number per session (two sessions both start at 0)', () => {
    const sessionA = createSession(db);
    const sessionB = createSession(db);
    expect(createCycleAtomic(db, { session_id: sessionA, phase: 'pipeline' }).cycle_number).toBe(0);
    expect(createCycleAtomic(db, { session_id: sessionB, phase: 'pipeline' }).cycle_number).toBe(0);
    expect(createCycleAtomic(db, { session_id: sessionA, phase: 'pipeline' }).cycle_number).toBe(1);
  });

  it('respects explicit cycle_number when provided (test-helper use)', () => {
    const sessionId = createSession(db);
    const c = createCycleAtomic(db, { session_id: sessionId, phase: 'pipeline', cycle_number: 42 });
    expect(c.cycle_number).toBe(42);
    // Next auto-assign continues from max+1
    const next = createCycleAtomic(db, { session_id: sessionId, phase: 'pipeline' });
    expect(next.cycle_number).toBe(43);
  });
});

describe('UNIQUE(session_id, cycle_number) index', () => {
  it('rejects duplicate (session_id, cycle_number) inserts after index creation', () => {
    const sessionId = createSession(db);
    // Insert cycle #1 via helper
    createCycleAtomic(db, { session_id: sessionId, phase: 'pipeline', cycle_number: 1 });

    // Add the UNIQUE index AFTER data exists (migration scenario with no dups)
    db.exec('CREATE UNIQUE INDEX idx_auto_cycles_unique ON auto_cycles(session_id, cycle_number)');

    // Direct INSERT attempting the same (session, number) must throw
    expect(() =>
      db.prepare(
        'INSERT INTO auto_cycles (id, session_id, cycle_number, phase, status, output, started_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(uuidv4(), sessionId, 1, 'pipeline', 'running', '', new Date().toISOString()),
    ).toThrow(/UNIQUE/);
  });

  it('migration renumbers existing duplicates then adds UNIQUE index cleanly', () => {
    const sessionId = createSession(db);
    const now = new Date().toISOString();
    // Seed three duplicates of cycle_number=5
    for (let i = 0; i < 3; i++) {
      db.prepare(
        'INSERT INTO auto_cycles (id, session_id, cycle_number, phase, status, output, started_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(uuidv4(), sessionId, 5, 'pipeline', 'completed', '', now);
    }

    // --- Migration logic (mirrors production) ---
    // 1. Find duplicate groups; for each group keep the earliest row and renumber the rest to fresh max+N slots
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

    // Group by (session, cycle_number); keep index 0, renumber the rest
    const grouped = new Map<string, typeof dupRows>();
    for (const r of dupRows) {
      const key = `${r.session_id}:${r.cycle_number}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(r);
    }

    const updateStmt = db.prepare('UPDATE auto_cycles SET cycle_number = ? WHERE id = ?');
    for (const [key, rows] of grouped) {
      const sessionIdOfGroup = key.split(':')[0];
      for (let i = 1; i < rows.length; i++) {
        const nextRow = db.prepare(
          'SELECT COALESCE(MAX(cycle_number), -1) + 1 AS next FROM auto_cycles WHERE session_id = ?',
        ).get(sessionIdOfGroup) as { next: number };
        updateStmt.run(nextRow.next, rows[i].id);
      }
    }

    // 2. Create UNIQUE index — should succeed now
    expect(() => db.exec('CREATE UNIQUE INDEX idx_auto_cycles_unique ON auto_cycles(session_id, cycle_number)')).not.toThrow();

    // Verify no dups remain
    const dupCount = db.prepare(`
      SELECT COUNT(*) AS c FROM (
        SELECT session_id, cycle_number FROM auto_cycles
        GROUP BY session_id, cycle_number HAVING COUNT(*) > 1
      )
    `).get() as { c: number };
    expect(dupCount.c).toBe(0);

    // Three rows still present, just with distinct cycle_numbers
    const total = db.prepare('SELECT COUNT(*) AS c FROM auto_cycles WHERE session_id = ?').get(sessionId) as { c: number };
    expect(total.c).toBe(3);
  });
});
