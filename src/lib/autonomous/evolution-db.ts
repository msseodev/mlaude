import { getDb } from '../db';
import { v4 as uuidv4 } from 'uuid';
import type { PromptVariant, PromptVariantStatus } from './types';

// --- Init ---

export function initEvolutionTables(): void {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS auto_prompt_variants (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      system_prompt TEXT NOT NULL,
      parent_variant_id TEXT,
      generation INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      avg_score REAL,
      cycles_evaluated INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (agent_id) REFERENCES auto_agents(id) ON DELETE CASCADE
    );
  `);
}

// --- CRUD ---

export function createPromptVariant(data: {
  agent_id: string;
  system_prompt: string;
  parent_variant_id?: string | null;
  generation?: number;
  status?: PromptVariantStatus;
}): PromptVariant {
  const db = getDb();
  const id = uuidv4();
  const now = new Date().toISOString();

  db.prepare(
    'INSERT INTO auto_prompt_variants (id, agent_id, system_prompt, parent_variant_id, generation, status, avg_score, cycles_evaluated, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    id,
    data.agent_id,
    data.system_prompt,
    data.parent_variant_id ?? null,
    data.generation ?? 0,
    data.status ?? 'active',
    null,
    0,
    now,
  );

  return getPromptVariant(id)!;
}

export function getPromptVariant(id: string): PromptVariant | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM auto_prompt_variants WHERE id = ?').get(id) as PromptVariant | undefined;
}

export function getActiveVariant(agentId: string): PromptVariant | undefined {
  const db = getDb();
  return db.prepare(
    "SELECT * FROM auto_prompt_variants WHERE agent_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1"
  ).get(agentId) as PromptVariant | undefined;
}

export function updatePromptVariant(id: string, data: Partial<Pick<PromptVariant, 'status' | 'avg_score' | 'cycles_evaluated'>>): PromptVariant | undefined {
  const db = getDb();
  const existing = getPromptVariant(id);
  if (!existing) return undefined;

  const status = data.status ?? existing.status;
  const avgScore = data.avg_score !== undefined ? data.avg_score : existing.avg_score;
  const cyclesEvaluated = data.cycles_evaluated !== undefined ? data.cycles_evaluated : existing.cycles_evaluated;

  db.prepare(
    'UPDATE auto_prompt_variants SET status = ?, avg_score = ?, cycles_evaluated = ? WHERE id = ?'
  ).run(status, avgScore, cyclesEvaluated, id);

  return getPromptVariant(id);
}

export function getVariantHistory(agentId: string, limit?: number): PromptVariant[] {
  const db = getDb();
  if (limit !== undefined) {
    return db.prepare(
      'SELECT * FROM auto_prompt_variants WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?'
    ).all(agentId, limit) as PromptVariant[];
  }
  return db.prepare(
    'SELECT * FROM auto_prompt_variants WHERE agent_id = ? ORDER BY created_at DESC'
  ).all(agentId) as PromptVariant[];
}
