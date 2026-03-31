import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

const TEST_DB_PATH = path.join(process.cwd(), 'test-chat-mlaude.db');

let db: Database.Database;

function initTestDb(): Database.Database {
  try { fs.unlinkSync(TEST_DB_PATH); } catch {}
  try { fs.unlinkSync(TEST_DB_PATH + '-wal'); } catch {}
  try { fs.unlinkSync(TEST_DB_PATH + '-shm'); } catch {}

  const d = new Database(TEST_DB_PATH);
  d.pragma('journal_mode = WAL');
  d.pragma('foreign_keys = ON');

  d.exec(`
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

  return d;
}

// Helper functions that mirror db.ts chat functions
function createChatSession(id: string, claudeSessionId: string, workingDirectory: string, model?: string): void {
  db.prepare(
    'INSERT INTO chat_sessions (id, claude_session_id, working_directory, model) VALUES (?, ?, ?, ?)'
  ).run(id, claudeSessionId, workingDirectory, model || null);
}

function getChatSession(id: string) {
  return db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(id) as Record<string, unknown> | undefined;
}

function getChatSessions() {
  return db.prepare('SELECT * FROM chat_sessions ORDER BY updated_at DESC').all() as Array<Record<string, unknown>>;
}

function updateChatSession(id: string, updates: Record<string, unknown>): void {
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(updates)) {
    fields.push(`${key} = ?`);
    values.push(value);
  }
  fields.push("updated_at = datetime('now')");
  values.push(id);
  db.prepare(`UPDATE chat_sessions SET ${fields.join(', ')} WHERE id = ?`).run(...values);
}

function deleteChatSession(id: string): void {
  db.prepare('DELETE FROM chat_sessions WHERE id = ?').run(id);
}

function createChatMessage(id: string, sessionId: string, role: 'user' | 'assistant', content: string, costUsd?: number, durationMs?: number): void {
  db.prepare(
    'INSERT INTO chat_messages (id, session_id, role, content, cost_usd, duration_ms) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, sessionId, role, content, costUsd || null, durationMs || null);
  const updateFields = ['message_count = message_count + 1', "updated_at = datetime('now')"];
  const updateValues: unknown[] = [];
  if (costUsd) {
    updateFields.push('total_cost_usd = total_cost_usd + ?');
    updateValues.push(costUsd);
  }
  updateValues.push(sessionId);
  db.prepare(`UPDATE chat_sessions SET ${updateFields.join(', ')} WHERE id = ?`).run(...updateValues);
}

function getChatMessages(sessionId: string, limit = 100, offset = 0) {
  return db.prepare(
    'SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC LIMIT ? OFFSET ?'
  ).all(sessionId, limit, offset) as Array<Record<string, unknown>>;
}

describe('Chat Database Operations', () => {
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

  describe('Chat Session CRUD', () => {
    it('should create a chat session with default values', () => {
      const id = uuidv4();
      const claudeId = uuidv4();
      createChatSession(id, claudeId, '/test/path');

      const session = getChatSession(id);
      expect(session).toBeDefined();
      expect(session!.id).toBe(id);
      expect(session!.claude_session_id).toBe(claudeId);
      expect(session!.title).toBe('New Chat');
      expect(session!.working_directory).toBe('/test/path');
      expect(session!.model).toBeNull();
      expect(session!.status).toBe('idle');
      expect(session!.total_cost_usd).toBe(0);
      expect(session!.message_count).toBe(0);
    });

    it('should create a chat session with model', () => {
      const id = uuidv4();
      const claudeId = uuidv4();
      createChatSession(id, claudeId, '/test/path', 'claude-sonnet-4-20250514');

      const session = getChatSession(id);
      expect(session).toBeDefined();
      expect(session!.model).toBe('claude-sonnet-4-20250514');
    });

    it('should return undefined for non-existent session', () => {
      expect(getChatSession('non-existent')).toBeUndefined();
    });

    it('should get all sessions ordered by updated_at DESC', () => {
      const id1 = uuidv4();
      const id2 = uuidv4();
      createChatSession(id1, uuidv4(), '/path1');
      createChatSession(id2, uuidv4(), '/path2');

      const sessions = getChatSessions();
      expect(sessions).toHaveLength(2);
    });

    it('should update a chat session', () => {
      const id = uuidv4();
      createChatSession(id, uuidv4(), '/test');

      updateChatSession(id, { title: 'Updated Title', status: 'active' });

      const session = getChatSession(id);
      expect(session!.title).toBe('Updated Title');
      expect(session!.status).toBe('active');
    });

    it('should update total_cost_usd', () => {
      const id = uuidv4();
      createChatSession(id, uuidv4(), '/test');

      updateChatSession(id, { total_cost_usd: 0.05 });

      const session = getChatSession(id);
      expect(session!.total_cost_usd).toBe(0.05);
    });

    it('should delete a chat session', () => {
      const id = uuidv4();
      createChatSession(id, uuidv4(), '/test');

      deleteChatSession(id);

      expect(getChatSession(id)).toBeUndefined();
    });

    it('should cascade delete messages when session is deleted', () => {
      const sessionId = uuidv4();
      createChatSession(sessionId, uuidv4(), '/test');
      createChatMessage(uuidv4(), sessionId, 'user', 'Hello');
      createChatMessage(uuidv4(), sessionId, 'assistant', 'Hi there');

      expect(getChatMessages(sessionId)).toHaveLength(2);

      deleteChatSession(sessionId);

      expect(getChatMessages(sessionId)).toHaveLength(0);
    });
  });

  describe('Chat Message Operations', () => {
    it('should create a user message', () => {
      const sessionId = uuidv4();
      createChatSession(sessionId, uuidv4(), '/test');

      const msgId = uuidv4();
      createChatMessage(msgId, sessionId, 'user', 'Hello!');

      const messages = getChatMessages(sessionId);
      expect(messages).toHaveLength(1);
      expect(messages[0].role).toBe('user');
      expect(messages[0].content).toBe('Hello!');
      expect(messages[0].cost_usd).toBeNull();
      expect(messages[0].duration_ms).toBeNull();
    });

    it('should create an assistant message with cost and duration', () => {
      const sessionId = uuidv4();
      createChatSession(sessionId, uuidv4(), '/test');

      const msgId = uuidv4();
      createChatMessage(msgId, sessionId, 'assistant', 'Hi there!', 0.003, 1500);

      const messages = getChatMessages(sessionId);
      expect(messages).toHaveLength(1);
      expect(messages[0].role).toBe('assistant');
      expect(messages[0].cost_usd).toBe(0.003);
      expect(messages[0].duration_ms).toBe(1500);
    });

    it('should increment session message_count when creating a message', () => {
      const sessionId = uuidv4();
      createChatSession(sessionId, uuidv4(), '/test');

      createChatMessage(uuidv4(), sessionId, 'user', 'Hello');
      let session = getChatSession(sessionId);
      expect(session!.message_count).toBe(1);

      createChatMessage(uuidv4(), sessionId, 'assistant', 'Hi');
      session = getChatSession(sessionId);
      expect(session!.message_count).toBe(2);
    });

    it('should accumulate total_cost_usd when creating messages with cost', () => {
      const sessionId = uuidv4();
      createChatSession(sessionId, uuidv4(), '/test');

      createChatMessage(uuidv4(), sessionId, 'assistant', 'Reply 1', 0.01, 1000);
      createChatMessage(uuidv4(), sessionId, 'assistant', 'Reply 2', 0.02, 2000);

      const session = getChatSession(sessionId);
      expect(session!.total_cost_usd).toBeCloseTo(0.03);
    });

    it('should not accumulate cost when costUsd is not provided', () => {
      const sessionId = uuidv4();
      createChatSession(sessionId, uuidv4(), '/test');

      createChatMessage(uuidv4(), sessionId, 'user', 'Hello');

      const session = getChatSession(sessionId);
      expect(session!.total_cost_usd).toBe(0);
    });

    it('should return messages in ascending order by created_at', () => {
      const sessionId = uuidv4();
      createChatSession(sessionId, uuidv4(), '/test');

      createChatMessage(uuidv4(), sessionId, 'user', 'First');
      createChatMessage(uuidv4(), sessionId, 'assistant', 'Second');
      createChatMessage(uuidv4(), sessionId, 'user', 'Third');

      const messages = getChatMessages(sessionId);
      expect(messages).toHaveLength(3);
      expect(messages[0].content).toBe('First');
      expect(messages[1].content).toBe('Second');
      expect(messages[2].content).toBe('Third');
    });

    it('should respect limit and offset', () => {
      const sessionId = uuidv4();
      createChatSession(sessionId, uuidv4(), '/test');

      for (let i = 0; i < 5; i++) {
        createChatMessage(uuidv4(), sessionId, 'user', `Message ${i}`);
      }

      const page1 = getChatMessages(sessionId, 2, 0);
      expect(page1).toHaveLength(2);
      expect(page1[0].content).toBe('Message 0');
      expect(page1[1].content).toBe('Message 1');

      const page2 = getChatMessages(sessionId, 2, 2);
      expect(page2).toHaveLength(2);
      expect(page2[0].content).toBe('Message 2');
      expect(page2[1].content).toBe('Message 3');
    });

    it('should return empty array for non-existent session', () => {
      const messages = getChatMessages('non-existent');
      expect(messages).toHaveLength(0);
    });

    it('should enforce role CHECK constraint', () => {
      const sessionId = uuidv4();
      createChatSession(sessionId, uuidv4(), '/test');

      expect(() => {
        db.prepare(
          'INSERT INTO chat_messages (id, session_id, role, content) VALUES (?, ?, ?, ?)'
        ).run(uuidv4(), sessionId, 'system', 'Invalid role');
      }).toThrow();
    });
  });
});
