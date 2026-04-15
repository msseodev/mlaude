import { describe, it, expect } from 'vitest';
import { formatToolSummary } from '../../src/lib/format-tool-summary';

describe('formatToolSummary', () => {
  it('Bash: uses command field', () => {
    expect(formatToolSummary('Bash', { command: 'echo hi' })).toBe('echo hi');
  });

  it('Read: uses file_path field', () => {
    expect(formatToolSummary('Read', { file_path: '/src/app.ts' })).toBe('/src/app.ts');
  });

  it('Write: uses file_path field', () => {
    expect(formatToolSummary('Write', { file_path: '/out/result.ts' })).toBe('/out/result.ts');
  });

  it('Edit: uses file_path field', () => {
    expect(formatToolSummary('Edit', { file_path: '/src/foo.ts' })).toBe('/src/foo.ts');
  });

  it('Grep: uses pattern and path', () => {
    expect(formatToolSummary('Grep', { pattern: 'useState', path: 'src/' })).toBe('useState, src/');
  });

  it('Grep: uses only pattern when path is missing', () => {
    expect(formatToolSummary('Grep', { pattern: 'foo' })).toBe('foo');
  });

  it('Glob: uses pattern field', () => {
    expect(formatToolSummary('Glob', { pattern: '**/*.ts' })).toBe('**/*.ts');
  });

  it('Agent: uses description field', () => {
    expect(formatToolSummary('Agent', { description: 'Run tests' })).toBe('Run tests');
  });

  it('WebSearch: uses query field', () => {
    expect(formatToolSummary('WebSearch', { query: 'vitest mocking' })).toBe('vitest mocking');
  });

  it('WebFetch: uses url field', () => {
    expect(formatToolSummary('WebFetch', { url: 'https://example.com' })).toBe('https://example.com');
  });

  it('default: JSON-serialises unknown tool input', () => {
    const result = formatToolSummary('UnknownTool', { foo: 'bar' });
    expect(result).toBe('{"foo":"bar"}');
  });

  it('truncates long summaries to 200 chars', () => {
    const long = 'x'.repeat(300);
    const result = formatToolSummary('Bash', { command: long });
    expect(result.length).toBe(203); // 200 + '...'
    expect(result.endsWith('...')).toBe(true);
  });

  it('truncates default JSON at 120 chars before appending ...', () => {
    const big: Record<string, string> = {};
    for (let i = 0; i < 20; i++) big[`key${i}`] = 'v'.repeat(10);
    const json = JSON.stringify(big);
    expect(json.length).toBeGreaterThan(120);
    const result = formatToolSummary('UnknownBig', big);
    // Should be truncated to 120 + '...' = 123, or then further truncated at 200 — either way must end with '...'
    expect(result.endsWith('...')).toBe(true);
    expect(result.length).toBeLessThanOrEqual(203);
  });

  it('handles empty input gracefully', () => {
    const result = formatToolSummary('Bash', {});
    expect(result).toBe('');
  });

  // ── Problem 5: new tool cases ─────────────────────────────────────────────

  describe('TeamCreate', () => {
    it('uses team_name field', () => {
      expect(formatToolSummary('TeamCreate', { team_name: 'planning-team' })).toBe('planning-team');
    });

    it('falls back to "team" when team_name is missing', () => {
      expect(formatToolSummary('TeamCreate', {})).toBe('team');
    });
  });

  describe('TodoWrite', () => {
    it('shows count and first todo content when todos is an array', () => {
      const todos = [
        { content: 'Analyse requirements', status: 'pending' },
        { content: 'Write tests', status: 'pending' },
      ];
      const result = formatToolSummary('TodoWrite', { todos });
      expect(result).toMatch(/^2 todos/);
      expect(result).toContain('Analyse requirements');
    });

    it('truncates first todo content to ~60 chars', () => {
      const longContent = 'A'.repeat(80);
      const todos = [{ content: longContent, status: 'pending' }];
      const result = formatToolSummary('TodoWrite', { todos });
      // Should include truncated content (not full 80 chars)
      expect(result.length).toBeLessThan(longContent.length + 20);
    });

    it('uses activeForm when content is missing', () => {
      const todos = [{ activeForm: 'Fix the bug', status: 'pending' }];
      const result = formatToolSummary('TodoWrite', { todos });
      expect(result).toContain('Fix the bug');
    });

    it('shows only count when first todo has neither content nor activeForm', () => {
      const todos = [{ status: 'pending' }, { status: 'done' }];
      const result = formatToolSummary('TodoWrite', { todos });
      expect(result).toBe('2 todos');
    });

    it('handles non-array todos gracefully (falls through to default)', () => {
      // When todos is not an array, should not crash
      expect(() => formatToolSummary('TodoWrite', { todos: 'invalid' })).not.toThrow();
    });

    it('handles missing todos field gracefully', () => {
      expect(() => formatToolSummary('TodoWrite', {})).not.toThrow();
    });
  });

  describe('SendMessage', () => {
    it('formats to and summary', () => {
      const result = formatToolSummary('SendMessage', { to: 'developer', summary: 'Please fix bug' });
      expect(result).toBe('→developer: Please fix bug');
    });

    it('falls back to message.type when summary is missing', () => {
      const result = formatToolSummary('SendMessage', { to: 'reviewer', message: { type: 'task' } });
      expect(result).toBe('→reviewer: task');
    });

    it('trims trailing ": " when both summary and message.type are absent', () => {
      const result = formatToolSummary('SendMessage', { to: 'planner' });
      expect(result).toBe('→planner');
    });

    it('uses "?" when to is missing', () => {
      const result = formatToolSummary('SendMessage', { summary: 'hello' });
      expect(result).toBe('→?: hello');
    });

    it('handles completely empty input', () => {
      const result = formatToolSummary('SendMessage', {});
      expect(result).toBe('→?');
    });
  });

  describe('ToolSearch', () => {
    it('uses query field', () => {
      expect(formatToolSummary('ToolSearch', { query: 'file read tools' })).toBe('file read tools');
    });

    it('returns empty string when query is missing', () => {
      expect(formatToolSummary('ToolSearch', {})).toBe('');
    });
  });
});
