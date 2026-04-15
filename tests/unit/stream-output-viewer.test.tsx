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
});
