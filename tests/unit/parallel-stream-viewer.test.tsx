/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ParallelStreamViewer } from '../../src/components/ParallelStreamViewer';
import type { StreamEntry } from '../../src/components/StreamOutputViewer';

interface TabData {
  id: string;
  label: string;
  entries: StreamEntry[];
  status?: 'running' | 'completed' | 'failed';
}

describe('ParallelStreamViewer', () => {
  it('renders a tab button for each tab', () => {
    const tabs: TabData[] = [
      { id: 'tab-1', label: 'Cycle 1', entries: [] },
      { id: 'tab-2', label: 'Cycle 2', entries: [] },
    ];
    render(<ParallelStreamViewer tabs={tabs} />);
    expect(screen.getByText('Cycle 1')).toBeTruthy();
    expect(screen.getByText('Cycle 2')).toBeTruthy();
  });

  it('shows entries for the first tab by default', () => {
    const tabs: TabData[] = [
      { id: 'tab-1', label: 'Cycle 1', entries: [{ type: 'text', text: 'output from tab 1' }] },
      { id: 'tab-2', label: 'Cycle 2', entries: [{ type: 'text', text: 'output from tab 2' }] },
    ];
    render(<ParallelStreamViewer tabs={tabs} />);
    expect(screen.getByText(/output from tab 1/)).toBeTruthy();
  });

  it('switches content when a different tab is clicked', () => {
    const tabs: TabData[] = [
      { id: 'tab-1', label: 'Cycle 1', entries: [{ type: 'text', text: 'content-tab-1' }] },
      { id: 'tab-2', label: 'Cycle 2', entries: [{ type: 'text', text: 'content-tab-2' }] },
    ];
    render(<ParallelStreamViewer tabs={tabs} />);
    fireEvent.click(screen.getByText('Cycle 2'));
    expect(screen.getByText(/content-tab-2/)).toBeTruthy();
  });

  it('honours controlled activeTabId prop', () => {
    const tabs: TabData[] = [
      { id: 'tab-1', label: 'Cycle 1', entries: [{ type: 'text', text: 'c1-content' }] },
      { id: 'tab-2', label: 'Cycle 2', entries: [{ type: 'text', text: 'c2-content' }] },
    ];
    render(<ParallelStreamViewer tabs={tabs} activeTabId="tab-2" />);
    expect(screen.getByText(/c2-content/)).toBeTruthy();
  });

  it('calls onTabChange when a tab is clicked', () => {
    const tabs: TabData[] = [
      { id: 'tab-1', label: 'Cycle 1', entries: [] },
      { id: 'tab-2', label: 'Cycle 2', entries: [] },
    ];
    const onTabChange = vi.fn();
    render(<ParallelStreamViewer tabs={tabs} onTabChange={onTabChange} />);
    fireEvent.click(screen.getByText('Cycle 2'));
    expect(onTabChange).toHaveBeenCalledWith('tab-2');
  });

  it('renders empty-state message when active tab has no entries', () => {
    const tabs: TabData[] = [
      { id: 'tab-1', label: 'Cycle 1', entries: [] },
    ];
    render(<ParallelStreamViewer tabs={tabs} emptyMessage="No data yet" />);
    expect(screen.getByText('No data yet')).toBeTruthy();
  });

  it('renders a status indicator for each tab based on status prop', () => {
    const tabs: TabData[] = [
      { id: 'tab-1', label: 'Cycle 1', entries: [], status: 'running' },
      { id: 'tab-2', label: 'Cycle 2', entries: [], status: 'completed' },
      { id: 'tab-3', label: 'Cycle 3', entries: [], status: 'failed' },
    ];
    const { container } = render(<ParallelStreamViewer tabs={tabs} />);
    // Each tab should have a coloured status dot
    const runningDot = container.querySelector('.bg-blue-400');
    const completedDot = container.querySelector('.bg-green-400');
    const failedDot = container.querySelector('.bg-red-400');
    expect(runningDot).toBeTruthy();
    expect(completedDot).toBeTruthy();
    expect(failedDot).toBeTruthy();
  });

  it('does not throw when tabs array is empty', () => {
    expect(() => render(<ParallelStreamViewer tabs={[]} />)).not.toThrow();
  });
});
