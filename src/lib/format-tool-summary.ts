/**
 * Formats a tool call's input into a concise summary string.
 * Extracted from src/app/run/page.tsx so it can be shared between
 * the manual-mode and auto-mode output viewers.
 */
export function formatToolSummary(tool: string, input: Record<string, unknown>): string {
  let summary = '';
  switch (tool) {
    case 'Bash':
      summary = (input.command as string) ?? '';
      break;
    case 'Read':
      summary = (input.file_path as string) ?? '';
      break;
    case 'Write':
      summary = (input.file_path as string) ?? '';
      break;
    case 'Edit':
      summary = (input.file_path as string) ?? '';
      break;
    case 'Grep': {
      const pattern = (input.pattern as string) ?? '';
      const filePath = (input.path as string) ?? '';
      summary = filePath ? `${pattern}, ${filePath}` : pattern;
      break;
    }
    case 'Glob':
      summary = (input.pattern as string) ?? '';
      break;
    case 'Agent':
      summary = (input.description as string) ?? '';
      break;
    case 'WebSearch':
      summary = (input.query as string) ?? '';
      break;
    case 'WebFetch':
      summary = (input.url as string) ?? '';
      break;
    default: {
      const json = JSON.stringify(input);
      summary = json.length > 120 ? json.slice(0, 120) + '...' : json;
      break;
    }
  }
  // Truncate long summaries to 200 chars
  if (summary.length > 200) {
    summary = summary.slice(0, 200) + '...';
  }
  return summary;
}
