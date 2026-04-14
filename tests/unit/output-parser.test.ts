import { describe, it, expect } from 'vitest';
import { parseAgentOutput, parseTeamMessages } from '../../src/lib/autonomous/output-parser';

describe('parseAgentOutput', () => {
  describe('Smoke Tester output (uses QA JSON shape)', () => {
    it('parses test summary stats', () => {
      const rawOutput = JSON.stringify({
        summary: { passed: 8, failed: 2, total: 10 },
        failures: [{ test: 'login', error: 'timeout' }],
      });
      const result = parseAgentOutput('smoke_tester', rawOutput);
      expect(result.structuredData).not.toBeNull();
      expect(result.summary).toBe('Tests: 8 passed, 2 failed, 10 total');
    });

    it('handles Smoke Tester with space in name', () => {
      const rawOutput = '```json\n{"summary": {"passed": 5, "failed": 0, "total": 5}}\n```';
      const result = parseAgentOutput('Smoke Tester', rawOutput);
      expect(result.summary).toBe('Tests: 5 passed, 0 failed, 5 total');
    });

    it('uses 0 for missing summary fields', () => {
      const rawOutput = '{"summary": {}}';
      const result = parseAgentOutput('smoke_tester', rawOutput);
      expect(result.summary).toBe('Tests: 0 passed, 0 failed, 0 total');
    });
  });

  describe('Developer output (plain text, no structured JSON)', () => {
    it('returns raw output when under 1000 chars', () => {
      const rawOutput = 'I implemented the feature successfully. All tests pass.';
      const result = parseAgentOutput('developer', rawOutput);
      expect(result.structuredData).toBeNull();
      expect(result.summary).toBe(rawOutput);
    });

    it('truncates output to 1000 chars when over limit', () => {
      const rawOutput = 'A'.repeat(1500);
      const result = parseAgentOutput('developer', rawOutput);
      expect(result.structuredData).toBeNull();
      expect(result.summary).toHaveLength(1003); // 1000 + '...'
      expect(result.summary).toBe('A'.repeat(1000) + '...');
    });
  });

  describe('Malformed JSON', () => {
    it('returns null structuredData and truncated summary for malformed JSON', () => {
      const rawOutput = '```json\n{invalid json content here\n```';
      const result = parseAgentOutput('smoke_tester', rawOutput);
      expect(result.structuredData).toBeNull();
      expect(result.summary).toBe(rawOutput);
    });
  });

  describe('Empty output', () => {
    it('returns empty summary and null structuredData', () => {
      const result = parseAgentOutput('developer', '');
      expect(result.structuredData).toBeNull();
      expect(result.summary).toBe('');
    });

    it('returns empty summary for empty smoke_tester output', () => {
      const result = parseAgentOutput('smoke_tester', '');
      expect(result.structuredData).toBeNull();
      expect(result.summary).toBe('');
    });
  });
});

describe('parseTeamMessages', () => {
  it('extracts team messages from JSON code block', () => {
    const output = `Here are my observations:

\`\`\`json
{
  "team_messages": [
    { "category": "convention", "content": "Always use camelCase for variable names" }
  ]
}
\`\`\`

That's all.`;

    const result = parseTeamMessages(output);
    expect(result).toHaveLength(1);
    expect(result[0].category).toBe('convention');
    expect(result[0].content).toBe('Always use camelCase for variable names');
  });

  it('extracts team messages from raw JSON', () => {
    // Raw JSON fallback uses non-greedy regex, so test with JSON that the regex can match.
    // For nested objects, code blocks (tested above) are the primary extraction path.
    const rawJson = JSON.stringify({
      team_messages: [{ category: 'architecture', content: 'Use repository pattern for data access' }],
    });
    const output = `Some text before ${rawJson} and after`;

    const result = parseTeamMessages(output);
    expect(result).toHaveLength(1);
    expect(result[0].category).toBe('architecture');
    expect(result[0].content).toBe('Use repository pattern for data access');
  });

  it('handles singular team_message form', () => {
    const output = `\`\`\`json
{ "team_message": { "category": "warning", "content": "Do not use any() type" } }
\`\`\``;

    const result = parseTeamMessages(output);
    expect(result).toHaveLength(1);
    expect(result[0].category).toBe('warning');
    expect(result[0].content).toBe('Do not use any() type');
  });

  it('validates category (rejects invalid)', () => {
    const output = `\`\`\`json
{
  "team_messages": [
    { "category": "invalid_category", "content": "This should be rejected" },
    { "category": "convention", "content": "This should be accepted" }
  ]
}
\`\`\``;

    const result = parseTeamMessages(output);
    expect(result).toHaveLength(1);
    expect(result[0].category).toBe('convention');
  });

  it('validates content (rejects empty)', () => {
    const output = `\`\`\`json
{
  "team_messages": [
    { "category": "convention", "content": "" },
    { "category": "convention", "content": "   " },
    { "category": "pattern", "content": "Valid content" }
  ]
}
\`\`\``;

    const result = parseTeamMessages(output);
    expect(result).toHaveLength(1);
    expect(result[0].category).toBe('pattern');
    expect(result[0].content).toBe('Valid content');
  });

  it('returns empty array when no team messages found', () => {
    const output = 'This is just some regular output with no team messages at all.';

    const result = parseTeamMessages(output);
    expect(result).toEqual([]);
  });

  it('handles multiple team messages', () => {
    const output = `\`\`\`json
{
  "team_messages": [
    { "category": "convention", "content": "Use const over let when possible" },
    { "category": "architecture", "content": "All API routes should validate input" },
    { "category": "pattern", "content": "Use early returns to reduce nesting" }
  ]
}
\`\`\``;

    const result = parseTeamMessages(output);
    expect(result).toHaveLength(3);
    expect(result[0].category).toBe('convention');
    expect(result[1].category).toBe('architecture');
    expect(result[2].category).toBe('pattern');
  });
});
