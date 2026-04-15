'use client';

import { useState } from 'react';
import { StreamOutputViewer } from '@/components/StreamOutputViewer';
import type { StreamEntry } from '@/components/StreamOutputViewer';

export interface ParallelTab {
  id: string;
  label: string;
  entries: StreamEntry[];
  status?: 'running' | 'completed' | 'failed';
}

export interface ParallelStreamViewerProps {
  tabs: ParallelTab[];
  /** Controlled active tab id. When provided the component is controlled. */
  activeTabId?: string;
  /** Called when the user clicks a tab button. */
  onTabChange?: (id: string) => void;
  /** Forwarded to the inner StreamOutputViewer. */
  maxHeight?: string;
  emptyMessage?: string;
}

function statusDotClass(status: ParallelTab['status']): string {
  switch (status) {
    case 'running':
      return 'bg-blue-400';
    case 'completed':
      return 'bg-green-400';
    case 'failed':
      return 'bg-red-400';
    default:
      return 'bg-gray-400';
  }
}

export function ParallelStreamViewer({
  tabs,
  activeTabId: controlledActiveTabId,
  onTabChange,
  maxHeight,
  emptyMessage,
}: ParallelStreamViewerProps) {
  const [internalActiveId, setInternalActiveId] = useState<string | null>(null);

  const activeId =
    controlledActiveTabId ?? internalActiveId ?? (tabs.length > 0 ? tabs[0].id : null);

  function handleTabClick(id: string) {
    if (controlledActiveTabId === undefined) {
      // Uncontrolled: manage internal state
      setInternalActiveId(id);
    }
    onTabChange?.(id);
  }

  const activeTab = tabs.find((t) => t.id === activeId) ?? tabs[0] ?? null;

  return (
    <div>
      {/* Tab bar */}
      <div className="flex border-b border-gray-700 mb-2">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => handleTabClick(tab.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeId === tab.id
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-gray-400 hover:text-gray-300'
            }`}
          >
            {tab.label}
            {tab.status !== undefined && (
              <span
                className={`ml-2 inline-block h-2 w-2 rounded-full ${statusDotClass(tab.status)}`}
              />
            )}
          </button>
        ))}
      </div>

      {/* Output viewer for active tab */}
      <StreamOutputViewer
        entries={activeTab?.entries ?? []}
        maxHeight={maxHeight}
        emptyMessage={emptyMessage}
      />
    </div>
  );
}
