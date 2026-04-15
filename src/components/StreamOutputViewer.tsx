'use client';

import { useRef, useEffect } from 'react';
import { MarkdownOutput } from '@/components/auto/MarkdownOutput';

/**
 * Typed union of all entry types rendered by the viewer.
 * Both manual-mode (prompt_start/complete/failed) and auto-mode
 * (cycle_*, agent_*, phase_change) entries are handled.
 */
export type StreamEntryType =
  | 'text'
  | 'tool_call'
  | 'tool_result'
  | 'prompt_start'
  | 'prompt_complete'
  | 'prompt_failed'
  | 'cycle_start'
  | 'cycle_complete'
  | 'cycle_failed'
  | 'agent_start'
  | 'agent_complete'
  | 'agent_failed'
  | 'phase_change'
  | 'review_iteration'
  | 'tool_start'
  | 'tool_end'
  // Allow unknown future types via the string index
  | (string & Record<never, never>);

export interface StreamEntry {
  type: StreamEntryType;
  text: string;
}

export interface StreamOutputViewerProps {
  entries: StreamEntry[];
  /** CSS max-height value. Defaults to '24rem'. */
  maxHeight?: string;
  /** Whether to auto-scroll to the bottom when new entries arrive. Default true. */
  autoScroll?: boolean;
  /** Message shown when entries is empty. */
  emptyMessage?: string;
}

/** Tailwind class(es) for each entry type. Single source of truth for all colours. */
function colorForType(type: string): string {
  switch (type) {
    case 'tool_call':
    case 'tool_start':
    case 'tool_end':
      return 'text-cyan-400 font-semibold';
    case 'cycle_start':
    case 'phase_change':
    case 'agent_start':
      return 'text-green-400 font-bold';
    case 'prompt_start':
      return 'text-green-400 font-bold';
    case 'cycle_complete':
    case 'prompt_complete':
    case 'agent_complete':
      return 'text-green-400';
    case 'cycle_failed':
    case 'prompt_failed':
    case 'agent_failed':
      return 'text-red-400';
    case 'cli_error':
      return 'text-red-400 font-semibold';
    case 'review_iteration':
      return 'text-yellow-400';
    default:
      return 'text-gray-100';
  }
}

export function StreamOutputViewer({
  entries,
  maxHeight = '24rem',
  autoScroll = true,
  emptyMessage = 'Waiting for output...',
}: StreamOutputViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(autoScroll);

  // Keep autoScrollRef in sync when prop changes
  useEffect(() => {
    autoScrollRef.current = autoScroll;
  }, [autoScroll]);

  // Scroll to bottom when entries change (if auto-scroll is enabled)
  useEffect(() => {
    const el = containerRef.current;
    if (el && autoScrollRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [entries]);

  function handleScroll() {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    autoScrollRef.current = atBottom;
  }

  function renderEntry(entry: StreamEntry, i: number) {
    switch (entry.type) {
      case 'text': {
        // Render markdown (bold, inline code, lists, links, code blocks — the
        // kinds of things agents emit inline while streaming).
        // Stream chunks occasionally arrive with 3+ consecutive newlines as
        // padding; each pair of blank lines would otherwise produce an empty
        // <p>, ballooning the viewer. Collapse to at most one blank line.
        const normalized = entry.text.replace(/\n{3,}/g, '\n\n');
        return <MarkdownOutput key={i} text={normalized} />;
      }

      case 'tool_result': {
        // Cap tool_result to a few lines so grep/read output doesn't spawn
        // an inner scrollbar (which would collide with the viewer's own
        // scroll — the ugly double-scroll case). Extra lines collapse to
        // a single italic "N more lines" indicator.
        const MAX_LINES = 8;
        const lines = entry.text.split('\n');
        const truncated = lines.length > MAX_LINES;
        const shown = truncated ? lines.slice(0, MAX_LINES).join('\n') : entry.text;
        return (
          <div
            key={i}
            className="mb-2 ml-2 text-gray-400 border-l-2 border-gray-600 pl-2 text-xs leading-relaxed"
          >
            <pre className="whitespace-pre-wrap">{shown}</pre>
            {truncated && (
              <div className="italic text-gray-500">
                … {lines.length - MAX_LINES} more lines
              </div>
            )}
          </div>
        );
      }

      default: {
        // tool_call, tool_start, tool_end, prompt_*, cycle_*, agent_*, phase_change,
        // review_iteration, and any future unknown types all land here.
        // Each entry is a block-level div so it never bleeds onto the same visual
        // line as an adjacent entry regardless of neighbour type (fixes Problems 1+2).
        // Color is driven entirely by colorForType — no duplicated declarations.
        const colour = colorForType(entry.type);
        return (
          <div key={i} className={colour}>
            {entry.text}
          </div>
        );
      }
    }
  }

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto whitespace-pre-wrap break-words rounded-lg p-4 font-mono text-sm leading-relaxed"
      style={{ backgroundColor: '#1E1E1E', maxHeight }}
    >
      {entries.length === 0 ? (
        <p className="text-gray-500">{emptyMessage}</p>
      ) : (
        entries.map((entry, i) => renderEntry(entry, i))
      )}
    </div>
  );
}
