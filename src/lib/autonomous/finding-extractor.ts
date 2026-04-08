import { v4 as uuidv4 } from 'uuid';
import type { ExtractedFinding, FindingCategory, FindingPriority, AutoFinding } from './types';

const VALID_CATEGORIES: FindingCategory[] = ['bug', 'improvement', 'idea', 'test_failure', 'performance', 'accessibility', 'security'];
const VALID_PRIORITIES: FindingPriority[] = ['P0', 'P1', 'P2', 'P3'];

export class FindingExtractor {
  /**
   * Extract findings from Claude's output.
   * Looks for a JSON block containing { "findings": [...] }
   */
  extract(claudeOutput: string, existingFindings?: AutoFinding[], crossSessionFindings?: AutoFinding[]): ExtractedFinding[] {
    const jsonBlock = this.extractJsonBlock(claudeOutput);
    if (!jsonBlock) return [];

    try {
      const parsed = JSON.parse(jsonBlock);

      // Support "findings", Product Designer's "features", and Moderator's "agreed_items" formats
      let rawFindings: Record<string, unknown>[];
      if (Array.isArray(parsed.findings)) {
        rawFindings = parsed.findings;
      } else if (Array.isArray(parsed.features)) {
        // Convert features to findings format
        rawFindings = parsed.features.map((f: Record<string, unknown>) => ({
          ...f,
          category: f.category || 'improvement',
          file_path: Array.isArray(f.relevant_files) ? f.relevant_files[0] : f.file_path,
        }));
      } else if (Array.isArray(parsed.agreed_items)) {
        // Convert Planning Moderator's agreed_items to findings format
        rawFindings = parsed.agreed_items.map((item: Record<string, unknown>) => ({
          ...item,
          category: item.category || 'improvement',
          file_path: item.file_path || null,
          prd_path: item.prd_path || null,
        }));
      } else {
        rawFindings = [];
      }

      // Assign epic IDs: items sharing the same "epic" string get the same UUID
      const epicNameToId = new Map<string, string>();
      const validated = rawFindings
        .map((f: Record<string, unknown>) => {
          const finding = this.validateFinding(f);
          if (finding && f.epic && typeof f.epic === 'string') {
            const epicName = f.epic.trim();
            if (!epicNameToId.has(epicName)) {
              epicNameToId.set(epicName, uuidv4());
            }
            finding.epic_id = epicNameToId.get(epicName)!;
            finding.epic_order = typeof f.epic_order === 'number' ? f.epic_order : null;
          }
          return finding;
        })
        .filter((f: ExtractedFinding | null): f is ExtractedFinding => f !== null);

      const accepted: ExtractedFinding[] = [];
      for (const f of validated) {
        if (this.isDuplicate(f, existingFindings ?? [])) continue;
        if (this.isDuplicateOfCrossSession(f, crossSessionFindings ?? [])) continue;
        if (this.isDuplicateOfBatch(f, accepted)) continue;
        accepted.push(f);
      }
      return accepted;
    } catch {
      return [];
    }
  }

  /**
   * Extract JSON block from Claude output.
   * Looks for:
   * 1. ```json ... ``` code block containing findings, features, or agreed_items
   * 2. Raw JSON with findings, features, or agreed_items
   */
  private extractJsonBlock(text: string): string | null {
    // Limit input to prevent regex catastrophe on huge outputs
    const input = text.length > 100_000 ? text.slice(0, 100_000) : text;
    const knownKeys = ['"findings"', '"features"', '"agreed_items"'];

    // Try code block first
    const codeBlockMatch = input.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (codeBlockMatch) {
      const content = codeBlockMatch[1].trim();
      if (knownKeys.some(key => content.includes(key))) return content;
    }

    // Try raw JSON: find the key, then walk backward to find enclosing {
    for (const key of knownKeys) {
      const keyIdx = input.indexOf(key);
      if (keyIdx === -1) continue;
      const balanced = this.extractBalancedJson(input, keyIdx);
      if (balanced) return balanced;
    }

    return null;
  }

  /**
   * Extract balanced JSON starting from the given position.
   */
  private extractBalancedJson(text: string, startSearch: number): string | null {
    // Find the opening brace at or before startSearch
    const openIdx = text.lastIndexOf('{', startSearch);
    if (openIdx === -1) return null;

    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = openIdx; i < text.length; i++) {
      const ch = text[i];
      if (escape) { escape = false; continue; }
      if (ch === '\\' && inString) { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === '{') depth++;
      if (ch === '}') {
        depth--;
        if (depth === 0) {
          const candidate = text.slice(openIdx, i + 1);
          try {
            JSON.parse(candidate);
            return candidate;
          } catch {
            return null;
          }
        }
      }
    }
    return null;
  }

  /**
   * Validate a raw finding object and return a typed ExtractedFinding or null.
   */
  private validateFinding(raw: Record<string, unknown>): ExtractedFinding | null {
    const category = String(raw.category || '');
    const priority = String(raw.priority || 'P2');
    const title = String(raw.title || '');
    const description = String(raw.description || '');

    if (!title) return null;
    if (!VALID_CATEGORIES.includes(category as FindingCategory)) return null;

    return {
      category: category as FindingCategory,
      priority: VALID_PRIORITIES.includes(priority as FindingPriority) ? priority as FindingPriority : 'P2',
      title,
      description,
      file_path: raw.file_path ? String(raw.file_path) : null,
      prd_path: raw.prd_path ? String(raw.prd_path) : null,
    };
  }

  /**
   * Check if a finding is a duplicate of an existing one.
   * Simple title similarity check.
   */
  private isDuplicate(finding: ExtractedFinding, existing: AutoFinding[]): boolean {
    const normalizedTitle = finding.title.toLowerCase().trim();
    return existing.some(e => {
      const existingTitle = e.title.toLowerCase().trim();
      return existingTitle === normalizedTitle ||
             this.similarity(existingTitle, normalizedTitle) > 0.8;
    });
  }

  /**
   * Check if a finding is a duplicate of a cross-session finding (resolved or wont_fix).
   * Uses the same title similarity check as isDuplicate().
   */
  private isDuplicateOfCrossSession(finding: ExtractedFinding, crossSessionFindings: AutoFinding[]): boolean {
    const normalizedTitle = finding.title.toLowerCase().trim();
    return crossSessionFindings.some(e => {
      const existingTitle = e.title.toLowerCase().trim();
      return existingTitle === normalizedTitle ||
             this.similarity(existingTitle, normalizedTitle) > 0.8;
    });
  }

  /**
   * Check if a finding is a duplicate of another finding already accepted in the same batch.
   * Uses the same title similarity check as isDuplicate().
   */
  private isDuplicateOfBatch(finding: ExtractedFinding, accepted: ExtractedFinding[]): boolean {
    const normalizedTitle = finding.title.toLowerCase().trim();
    return accepted.some(e => {
      const existingTitle = e.title.toLowerCase().trim();
      return existingTitle === normalizedTitle ||
             this.similarity(existingTitle, normalizedTitle) > 0.8;
    });
  }

  /**
   * Simple string similarity (Dice coefficient).
   */
  private similarity(a: string, b: string): number {
    if (a === b) return 1;
    if (a.length < 2 || b.length < 2) return 0;

    const bigrams = new Map<string, number>();
    for (let i = 0; i < a.length - 1; i++) {
      const bigram = a.substring(i, i + 2);
      bigrams.set(bigram, (bigrams.get(bigram) || 0) + 1);
    }

    let intersections = 0;
    for (let i = 0; i < b.length - 1; i++) {
      const bigram = b.substring(i, i + 2);
      const count = bigrams.get(bigram) || 0;
      if (count > 0) {
        bigrams.set(bigram, count - 1);
        intersections++;
      }
    }

    return (2 * intersections) / (a.length + b.length - 2);
  }
}
