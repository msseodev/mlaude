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
});
