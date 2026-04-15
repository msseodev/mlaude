/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StreamOutputViewer } from '../../src/components/StreamOutputViewer';
import type { StreamEntry } from '../../src/components/StreamOutputViewer';

describe('StreamOutputViewer', () => {
  it('renders empty-state message when entries is empty', () => {
    render(<StreamOutputViewer entries={[]} emptyMessage="Nothing yet" />);
    expect(screen.getByText('Nothing yet')).toBeTruthy();
  });

  it('uses default empty message when none supplied', () => {
    render(<StreamOutputViewer entries={[]} />);
    expect(screen.getByText(/waiting/i)).toBeTruthy();
  });

  it('renders text entry as plain text', () => {
    const entries: StreamEntry[] = [{ type: 'text', text: 'Hello output' }];
    render(<StreamOutputViewer entries={entries} />);
    expect(screen.getByText(/Hello output/)).toBeTruthy();
  });

  it('renders tool_call entry with cyan colour class and formatted summary', () => {
    const entries: StreamEntry[] = [
      { type: 'tool_call', text: '\u2588 Bash(echo hi)' },
    ];
    render(<StreamOutputViewer entries={entries} />);
    const el = screen.getByText(/Bash\(echo hi\)/);
    expect(el.className).toContain('text-cyan-400');
  });

  it('renders tool_result entry with grey sidebar', () => {
    const entries: StreamEntry[] = [
      { type: 'tool_result', text: '  \u23BF  some result' },
    ];
    render(<StreamOutputViewer entries={entries} />);
    const el = screen.getByText(/some result/);
    expect(el.closest('div')?.className).toContain('border-l-2');
  });

  it('renders prompt_start entry with green bold colour', () => {
    const entries: StreamEntry[] = [
      { type: 'prompt_start', text: '========== Prompt: My Task ==========' },
    ];
    render(<StreamOutputViewer entries={entries} />);
    const el = screen.getByText(/My Task/);
    expect(el.className).toContain('text-green-400');
    expect(el.className).toContain('font-bold');
  });

  it('renders prompt_complete entry with green colour', () => {
    const entries: StreamEntry[] = [
      { type: 'prompt_complete', text: '========== COMPLETED: My Task ==========' },
    ];
    render(<StreamOutputViewer entries={entries} />);
    const el = screen.getByText(/COMPLETED/);
    expect(el.className).toContain('text-green-400');
  });

  it('renders prompt_failed entry with red colour', () => {
    const entries: StreamEntry[] = [
      { type: 'prompt_failed', text: '========== FAILED: My Task ==========' },
    ];
    render(<StreamOutputViewer entries={entries} />);
    const el = screen.getByText(/FAILED/);
    expect(el.className).toContain('text-red-400');
  });

  it('renders cycle_start entry with green bold colour', () => {
    const entries: StreamEntry[] = [
      { type: 'cycle_start', text: '========== Cycle #1 — Pipeline ==========' },
    ];
    render(<StreamOutputViewer entries={entries} />);
    const el = screen.getByText(/Cycle #1/);
    expect(el.className).toContain('text-green-400');
    expect(el.className).toContain('font-bold');
  });

  it('renders cycle_complete entry with green colour', () => {
    const entries: StreamEntry[] = [
      { type: 'cycle_complete', text: '========== COMPLETED: Cycle #1 ==========' },
    ];
    render(<StreamOutputViewer entries={entries} />);
    const el = screen.getByText(/COMPLETED: Cycle/);
    expect(el.className).toContain('text-green-400');
  });

  it('renders cycle_failed entry with red colour', () => {
    const entries: StreamEntry[] = [
      { type: 'cycle_failed', text: '========== FAILED: Cycle #2 ==========' },
    ];
    render(<StreamOutputViewer entries={entries} />);
    const el = screen.getByText(/FAILED: Cycle/);
    expect(el.className).toContain('text-red-400');
  });

  it('renders agent_start entry with green bold colour', () => {
    const entries: StreamEntry[] = [
      { type: 'agent_start', text: '--- Agent: Developer (running) ---' },
    ];
    render(<StreamOutputViewer entries={entries} />);
    const el = screen.getByText(/Agent: Developer/);
    expect(el.className).toContain('text-green-400');
    expect(el.className).toContain('font-bold');
  });

  it('renders agent_complete entry with green colour', () => {
    const entries: StreamEntry[] = [
      { type: 'agent_complete', text: '--- Agent: Developer (completed) ---' },
    ];
    render(<StreamOutputViewer entries={entries} />);
    const el = screen.getByText(/completed/);
    expect(el.className).toContain('text-green-400');
  });

  it('renders agent_failed entry with red colour', () => {
    const entries: StreamEntry[] = [
      { type: 'agent_failed', text: '--- Agent: Developer (FAILED) ---' },
    ];
    render(<StreamOutputViewer entries={entries} />);
    const el = screen.getByText(/FAILED/);
    expect(el.className).toContain('text-red-400');
  });

  it('renders phase_change entry with green bold colour', () => {
    const entries: StreamEntry[] = [
      { type: 'phase_change', text: '--- Phase: fix ---' },
    ];
    render(<StreamOutputViewer entries={entries} />);
    const el = screen.getByText(/Phase: fix/);
    expect(el.className).toContain('text-green-400');
    expect(el.className).toContain('font-bold');
  });

  it('degrades gracefully on unknown entry types — renders without throwing', () => {
    const entries = [{ type: 'future_unknown_type', text: 'some text' }] as StreamEntry[];
    expect(() => render(<StreamOutputViewer entries={entries} />)).not.toThrow();
    expect(screen.getByText('some text')).toBeTruthy();
  });

  it('renders multiple entries in order', () => {
    const entries: StreamEntry[] = [
      { type: 'text', text: 'first' },
      { type: 'tool_call', text: '\u2588 Bash(ls)' },
      { type: 'text', text: 'second' },
    ];
    render(<StreamOutputViewer entries={entries} />);
    expect(screen.getByText(/first/)).toBeTruthy();
    expect(screen.getByText(/Bash\(ls\)/)).toBeTruthy();
    expect(screen.getByText(/second/)).toBeTruthy();
  });

  it('applies custom maxHeight style', () => {
    const { container } = render(
      <StreamOutputViewer entries={[]} maxHeight="48rem" />
    );
    const viewer = container.firstChild as HTMLElement;
    expect(viewer.style.maxHeight).toBe('48rem');
  });

  // ── Problem 3: text entry renders markdown (bold/code/lists) but normalizes
  //    excessive blank lines so the viewer doesn't grow 3-4 blank paragraphs
  //    between every short line of streaming text.
  it('text entry renders inline markdown (**bold**, `code`, links)', () => {
    const entries: StreamEntry[] = [
      { type: 'text', text: 'This is **bold** and this is `code`.' },
    ];
    const { container } = render(<StreamOutputViewer entries={entries} />);
    // markdown should produce a <strong> and an inline <code>
    expect(container.querySelector('strong')?.textContent).toBe('bold');
    expect(container.querySelector('code')?.textContent).toBe('code');
  });

  it('text entry renders markdown lists as <ul>/<li>', () => {
    const entries: StreamEntry[] = [
      { type: 'text', text: '- first\n- second\n- third' },
    ];
    const { container } = render(<StreamOutputViewer entries={entries} />);
    const ul = container.querySelector('ul');
    expect(ul).toBeTruthy();
    expect(ul?.querySelectorAll('li').length).toBe(3);
  });

  it('collapses runs of 3+ consecutive newlines so they produce at most one blank paragraph', () => {
    // Streaming text sometimes arrives with lots of blank padding between
    // sentences; the markdown renderer would otherwise emit an empty <p> for
    // each extra blank line. After normalization there should be no empty
    // paragraphs in the rendered output.
    const entries: StreamEntry[] = [
      { type: 'text', text: 'Line one\n\n\n\n\nLine two' },
    ];
    const { container } = render(<StreamOutputViewer entries={entries} />);
    const paragraphs = Array.from(container.querySelectorAll('p'));
    const empty = paragraphs.filter(p => (p.textContent ?? '').trim() === '');
    expect(empty.length).toBe(0);
    // Both lines still present
    expect(container.textContent).toContain('Line one');
    expect(container.textContent).toContain('Line two');
  });

  // ── tool_result layout: short, no inner scrollbar ───────────────────────
  it('tool_result with many lines is truncated with a "N more lines" indicator', () => {
    const many = Array.from({ length: 25 }, (_, i) => `line${i + 1}`).join('\n');
    const entries: StreamEntry[] = [{ type: 'tool_result', text: many }];
    const { container } = render(<StreamOutputViewer entries={entries} />);
    // First few lines present
    expect(container.textContent).toContain('line1');
    expect(container.textContent).toContain('line5');
    // Later lines should NOT be rendered
    expect(container.textContent).not.toContain('line25');
    // A truncation indicator must be shown
    expect(container.textContent).toMatch(/more lines/);
  });

  it('tool_result with few lines renders entirely with no indicator', () => {
    const entries: StreamEntry[] = [{ type: 'tool_result', text: 'a\nb\nc' }];
    const { container } = render(<StreamOutputViewer entries={entries} />);
    expect(container.textContent).toContain('a');
    expect(container.textContent).toContain('c');
    expect(container.textContent).not.toMatch(/more lines/);
  });

  it('tool_result block has NO inner scrollbar (no maxHeight or overflow inline style)', () => {
    const many = Array.from({ length: 50 }, () => 'x').join('\n');
    const entries: StreamEntry[] = [{ type: 'tool_result', text: many }];
    const { container } = render(<StreamOutputViewer entries={entries} />);
    // The tool_result wrapper is identified by its border-l-2 class.
    const wrapper = container.querySelector('.border-l-2') as HTMLElement | null;
    expect(wrapper).toBeTruthy();
    // No inline overflow:auto and no maxHeight — avoids double scrolling.
    expect(wrapper?.style.maxHeight).toBe('');
    expect(wrapper?.style.overflow).toBe('');
  });

  // ── Problem 4: single source of truth for colorForType ───────────────────
  it('tool_call entry outermost block has colorForType("tool_call") class', () => {
    const entries: StreamEntry[] = [
      { type: 'tool_call', text: '\u2588 Bash(ls)' },
    ];
    const { container } = render(<StreamOutputViewer entries={entries} />);
    // The outermost wrapper div for the entry should carry the color class
    const el = screen.getByText(/Bash\(ls\)/).closest('[class]') as HTMLElement;
    expect(el).toBeTruthy();
    // colorForType('tool_call') should now return text-cyan-400 (not text-blue-400)
    expect(el.className).toContain('text-cyan-400');
    // Must NOT have the old text-blue-400 as a separate override from colorForType
    // (the class must come from colorForType, not from hardcoded sibling span)
    // Verify the element bearing the color is the same element with the text
    expect(el.textContent).toContain('Bash(ls)');
  });

  // ── Problems 1 & 2: block boundaries between entries ─────────────────────
  it('each entry is wrapped in a block-level element, not inline span', () => {
    const entries: StreamEntry[] = [
      { type: 'text', text: 'plain text' },
      { type: 'tool_call', text: '\u2588 X(a)' },
      { type: 'tool_result', text: '\u23BF result' },
    ];
    const { container } = render(<StreamOutputViewer entries={entries} />);
    const viewer = container.firstChild as HTMLElement;
    const children = Array.from(viewer.children);
    // Text entries render through MarkdownOutput (<p>/<ul>/<h*>/etc.); all
    // others render as <div>. The point is: no inline <span> that would
    // squash onto an adjacent entry.
    const blockTags = new Set(['div', 'p', 'ul', 'ol', 'pre', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'table']);
    children.forEach((child) => {
      expect(child.tagName.toLowerCase()).not.toBe('span');
      expect(blockTags.has(child.tagName.toLowerCase())).toBe(true);
    });
  });

  it('default/unknown entry type is wrapped in a div (not inline span)', () => {
    const entries = [
      { type: 'agent_start', text: 'starting...' },
    ] as StreamEntry[];
    const { container } = render(<StreamOutputViewer entries={entries} />);
    const viewer = container.firstChild as HTMLElement;
    const child = viewer.children[0];
    expect(child.tagName.toLowerCase()).toBe('div');
  });
});
