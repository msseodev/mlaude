import type { CEORequestType, TeamMessageCategory } from './types';

export interface ParsedAgentOutput {
  structuredData: Record<string, unknown> | null;
  summary: string;
}

export interface ParsedCEORequest {
  type: CEORequestType;
  title: string;
  description: string;
  blocking: boolean;
}

export function parseAgentOutput(agentName: string, rawOutput: string): ParsedAgentOutput {
  const structuredData = extractJson(rawOutput);
  const summary = generateSummary(agentName, rawOutput, structuredData);
  return { structuredData, summary };
}

function extractJson(output: string): Record<string, unknown> | null {
  // Try code block first: ```json ... ```
  const codeBlockMatch = output.match(/```json\s*\n([\s\S]*?)\n```/);
  if (codeBlockMatch) {
    try {
      const parsed = JSON.parse(codeBlockMatch[1]);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch { /* fall through */ }
  }

  // Try raw JSON patterns with known keys
  const jsonPatterns = [
    /\{[\s\S]*"features"[\s\S]*\}/,
    /\{[\s\S]*"agreed_items"[\s\S]*\}/,
    /\{[\s\S]*"findings"[\s\S]*\}/,
    /\{[\s\S]*"perspective"[\s\S]*\}/,
    /\{[\s\S]*"planning_summary"[\s\S]*\}/,
    /\{[\s\S]*"approved"[\s\S]*\}/,
    /\{[\s\S]*"summary"[\s\S]*\}/,
  ];

  for (const pattern of jsonPatterns) {
    const match = output.match(pattern);
    if (match) {
      try {
        const parsed = JSON.parse(match[0]);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch { /* try next */ }
    }
  }

  return null;
}

function generateSummary(
  agentName: string,
  rawOutput: string,
  structuredData: Record<string, unknown> | null,
): string {
  const nameLower = agentName.toLowerCase();

  // Product Designer
  if (nameLower === 'product_designer' || nameLower === 'product designer') {
    return summarizeDesigner(structuredData, rawOutput);
  }

  // Planning Moderator
  if (nameLower === 'planning_moderator' || nameLower === 'planning moderator') {
    return summarizeModerator(structuredData, rawOutput);
  }

  // Planner agents (UX, Tech, Biz, Music Domain, Smoke Tester)
  if (nameLower === 'ux_planner' || nameLower === 'ux planner'
    || nameLower === 'tech_planner' || nameLower === 'tech planner'
    || nameLower === 'biz_planner' || nameLower === 'biz planner'
    || nameLower === 'music_domain_planner' || nameLower === 'music domain planner'
    || nameLower === 'smoke_tester' || nameLower === 'smoke tester') {
    return summarizePlanner(structuredData, rawOutput);
  }

  // Reviewer
  if (nameLower === 'reviewer') {
    return summarizeReviewer(structuredData, rawOutput);
  }

  // QA Engineer
  if (nameLower === 'qa_engineer' || nameLower === 'qa engineer') {
    return summarizeQA(structuredData, rawOutput);
  }

  // Test Engineer (same handling as Developer — free-form output)
  if (nameLower === 'test_engineer' || nameLower === 'test engineer') {
    if (rawOutput.length <= 1000) {
      return rawOutput;
    }
    return rawOutput.slice(0, 1000) + '...';
  }

  // Default (Developer, etc.)
  if (rawOutput.length <= 1000) {
    return rawOutput;
  }
  return rawOutput.slice(0, 1000) + '...';
}

function summarizeDesigner(
  data: Record<string, unknown> | null,
  rawOutput: string,
): string {
  if (data && Array.isArray(data.features)) {
    const features = data.features as Array<Record<string, unknown>>;
    const featureList = features
      .map(f => `[${f.priority ?? 'P2'}] ${f.title ?? 'untitled'}`)
      .join('; ');
    const analysisSummary = typeof data.analysis_summary === 'string' ? data.analysis_summary : '';
    const parts = [`Proposed ${features.length} features: ${featureList}`];
    if (analysisSummary) {
      parts.push(analysisSummary);
    }
    return parts.join('. ');
  }
  if (rawOutput.length <= 1000) {
    return rawOutput;
  }
  return rawOutput.slice(0, 1000) + '...';
}

function summarizePlanner(
  data: Record<string, unknown> | null,
  rawOutput: string,
): string {
  if (data && Array.isArray(data.findings)) {
    const findings = data.findings as Array<Record<string, unknown>>;
    const perspective = typeof data.perspective === 'string' ? data.perspective : 'unknown';
    const findingList = findings
      .map(f => `[${f.priority ?? 'P2'}] ${f.title ?? 'untitled'}`)
      .join('; ');
    const summary = typeof data.summary === 'string' ? data.summary : '';
    const parts = [`[${perspective}] ${findings.length} findings: ${findingList}`];
    if (summary) {
      parts.push(summary);
    }
    return parts.join('. ');
  }
  if (rawOutput.length <= 1000) {
    return rawOutput;
  }
  return rawOutput.slice(0, 1000) + '...';
}

function summarizeModerator(
  data: Record<string, unknown> | null,
  rawOutput: string,
): string {
  if (data && Array.isArray(data.agreed_items)) {
    const items = data.agreed_items as Array<Record<string, unknown>>;
    const itemList = items
      .map(item => `[${item.priority ?? 'P2'}] ${item.title ?? 'untitled'}`)
      .join('; ');
    const planningSummary = typeof data.planning_summary === 'string' ? data.planning_summary : '';
    const conflicts = Array.isArray(data.conflicts_resolved) ? data.conflicts_resolved.length : 0;
    const deferred = Array.isArray(data.deferred_items) ? data.deferred_items.length : 0;
    const parts = [`Agreed on ${items.length} items: ${itemList}`];
    if (conflicts > 0) {
      parts.push(`${conflicts} conflicts resolved`);
    }
    if (deferred > 0) {
      parts.push(`${deferred} items deferred`);
    }
    if (planningSummary) {
      parts.push(planningSummary);
    }
    return parts.join('. ');
  }
  if (rawOutput.length <= 1000) {
    return rawOutput;
  }
  return rawOutput.slice(0, 1000) + '...';
}

function summarizeReviewer(
  data: Record<string, unknown> | null,
  rawOutput: string,
): string {
  if (data && typeof data.approved === 'boolean') {
    const status = data.approved ? 'APPROVED' : 'REJECTED';
    const issues = Array.isArray(data.issues) ? data.issues.length : 0;
    const summary = typeof data.summary === 'string' ? data.summary : '';
    const parts = [`Review: ${status} (${issues} issues)`];
    if (summary) {
      parts.push(summary);
    }
    return parts.join('. ');
  }
  if (rawOutput.length <= 1000) {
    return rawOutput;
  }
  return rawOutput.slice(0, 1000) + '...';
}

function summarizeQA(
  data: Record<string, unknown> | null,
  rawOutput: string,
): string {
  if (data && data.summary && typeof data.summary === 'object') {
    const s = data.summary as Record<string, unknown>;
    const passed = s.passed ?? 0;
    const failed = s.failed ?? 0;
    const total = s.total ?? 0;
    return `Tests: ${passed} passed, ${failed} failed, ${total} total`;
  }
  if (rawOutput.length <= 1000) {
    return rawOutput;
  }
  return rawOutput.slice(0, 1000) + '...';
}

// --- CEO request parsing ---

const VALID_CEO_REQUEST_TYPES = new Set(['permission', 'resource', 'decision', 'information']);

function isValidCEORequestType(value: unknown): value is CEORequestType {
  return typeof value === 'string' && VALID_CEO_REQUEST_TYPES.has(value);
}

function parseSingleCEORequest(obj: Record<string, unknown>): ParsedCEORequest | null {
  if (!obj || typeof obj !== 'object') return null;
  const type = obj.type;
  const title = obj.title;
  if (!isValidCEORequestType(type)) return null;
  if (typeof title !== 'string' || !title.trim()) return null;
  return {
    type,
    title: title.trim(),
    description: typeof obj.description === 'string' ? obj.description.trim() : '',
    blocking: obj.blocking === true,
  };
}

export function parseCEORequests(output: string): ParsedCEORequest[] {
  const results: ParsedCEORequest[] = [];

  // Try code block first: ```json ... ```
  const codeBlockMatches = output.matchAll(/```json\s*\n([\s\S]*?)\n```/g);
  for (const m of codeBlockMatches) {
    try {
      const parsed = JSON.parse(m[1]);
      if (parsed && typeof parsed === 'object') {
        const extracted = extractCEORequestsFromObject(parsed);
        results.push(...extracted);
      }
    } catch { /* continue */ }
  }

  if (results.length > 0) return results;

  // Try matching JSON objects with ceo_request(s) key
  const patterns = [
    /\{[\s\S]*?"ceo_requests"[\s\S]*?\}/g,
    /\{[\s\S]*?"ceo_request"[\s\S]*?\}/g,
  ];

  for (const pattern of patterns) {
    const matches = output.matchAll(pattern);
    for (const m of matches) {
      try {
        const parsed = JSON.parse(m[0]);
        const extracted = extractCEORequestsFromObject(parsed);
        results.push(...extracted);
      } catch { /* try next */ }
    }
    if (results.length > 0) return results;
  }

  return results;
}

function extractCEORequestsFromObject(obj: Record<string, unknown>): ParsedCEORequest[] {
  const results: ParsedCEORequest[] = [];

  // Array form: { "ceo_requests": [...] }
  if (Array.isArray(obj.ceo_requests)) {
    for (const item of obj.ceo_requests) {
      if (item && typeof item === 'object') {
        const parsed = parseSingleCEORequest(item as Record<string, unknown>);
        if (parsed) results.push(parsed);
      }
    }
  }

  // Singular form: { "ceo_request": {...} }
  if (obj.ceo_request && typeof obj.ceo_request === 'object' && !Array.isArray(obj.ceo_request)) {
    const parsed = parseSingleCEORequest(obj.ceo_request as Record<string, unknown>);
    if (parsed) results.push(parsed);
  }

  return results;
}

// --- Team message parsing ---

export interface ParsedTeamMessage {
  category: TeamMessageCategory;
  content: string;
}

const VALID_TEAM_MESSAGE_CATEGORIES = new Set(['convention', 'architecture', 'warning', 'limitation', 'pattern']);

function isValidTeamMessageCategory(value: unknown): value is TeamMessageCategory {
  return typeof value === 'string' && VALID_TEAM_MESSAGE_CATEGORIES.has(value);
}

function parseSingleTeamMessage(obj: Record<string, unknown>): ParsedTeamMessage | null {
  if (!obj || typeof obj !== 'object') return null;
  const category = obj.category;
  const content = obj.content;
  if (!isValidTeamMessageCategory(category)) return null;
  if (typeof content !== 'string' || !content.trim()) return null;
  return { category, content: content.trim() };
}

export function parseTeamMessages(output: string): ParsedTeamMessage[] {
  const results: ParsedTeamMessage[] = [];

  // Try code block first: ```json ... ```
  const codeBlockMatches = output.matchAll(/```json\s*\n([\s\S]*?)\n```/g);
  for (const m of codeBlockMatches) {
    try {
      const parsed = JSON.parse(m[1]);
      if (parsed && typeof parsed === 'object') {
        const extracted = extractTeamMessagesFromObject(parsed);
        results.push(...extracted);
      }
    } catch { /* continue */ }
  }

  if (results.length > 0) return results;

  // Fall back to balanced-brace extraction for raw JSON with team_message(s) keys
  const keys = ['team_messages', 'team_message'];
  for (const key of keys) {
    const keyIndex = output.indexOf(`"${key}"`);
    if (keyIndex === -1) continue;

    // Walk backwards to find the opening brace
    let startIdx = -1;
    for (let i = keyIndex - 1; i >= 0; i--) {
      if (output[i] === '{') { startIdx = i; break; }
    }
    if (startIdx === -1) continue;

    // Walk forward with balanced braces from startIdx
    let depth = 0;
    let endIdx = -1;
    for (let i = startIdx; i < output.length; i++) {
      if (output[i] === '{') depth++;
      else if (output[i] === '}') {
        depth--;
        if (depth === 0) { endIdx = i; break; }
      }
    }
    if (endIdx === -1) continue;

    try {
      const parsed = JSON.parse(output.slice(startIdx, endIdx + 1));
      const extracted = extractTeamMessagesFromObject(parsed);
      results.push(...extracted);
    } catch { /* try next key */ }
    if (results.length > 0) return results;
  }

  return results;
}

function extractTeamMessagesFromObject(obj: Record<string, unknown>): ParsedTeamMessage[] {
  const results: ParsedTeamMessage[] = [];

  // Array form: { "team_messages": [...] }
  if (Array.isArray(obj.team_messages)) {
    for (const item of obj.team_messages) {
      if (item && typeof item === 'object') {
        const parsed = parseSingleTeamMessage(item as Record<string, unknown>);
        if (parsed) results.push(parsed);
      }
    }
  }

  // Singular form: { "team_message": {...} }
  if (obj.team_message && typeof obj.team_message === 'object' && !Array.isArray(obj.team_message)) {
    const parsed = parseSingleTeamMessage(obj.team_message as Record<string, unknown>);
    if (parsed) results.push(parsed);
  }

  return results;
}
