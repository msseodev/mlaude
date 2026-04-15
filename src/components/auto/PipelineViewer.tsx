'use client';

import { useState } from 'react';
import { StreamOutputViewer } from '@/components/StreamOutputViewer';
import type { StreamEntry } from '@/components/StreamOutputViewer';

interface PipelineAgent {
  id: string;
  name: string;
  status: string; // 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
}

interface PipelineViewerProps {
  cycleNumber: number;
  agents: PipelineAgent[];
  currentAgentId: string | null;
  output: StreamEntry[];
}

const statusIcon = (status: string) => {
  switch (status) {
    case 'completed': return '\u2705';
    case 'running': return '\u23F3';
    case 'failed': return '\u274C';
    case 'skipped': return '\u23ED\uFE0F';
    default: return '\u2B1C';
  }
};

export function PipelineViewer({ cycleNumber, agents, currentAgentId, output }: PipelineViewerProps) {
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const activeAgentId = selectedAgent || currentAgentId || (agents.length > 0 ? agents[0].id : null);

  return (
    <div className="mb-4">
      {/* Pipeline tabs */}
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-sm font-medium text-gray-700">
          Cycle #{cycleNumber} — Pipeline
        </h2>
      </div>
      <div className="mb-2 flex flex-wrap gap-1">
        {agents.map((agent) => (
          <button
            key={agent.id}
            onClick={() => setSelectedAgent(agent.id)}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              activeAgentId === agent.id
                ? 'bg-blue-100 text-blue-800 ring-1 ring-blue-300'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            <span>{statusIcon(agent.status)}</span>
            <span>{agent.name}</span>
          </button>
        ))}
      </div>

      {/* Shared streaming output viewer — single source of truth for entry rendering. */}
      <StreamOutputViewer entries={output} emptyMessage="Waiting for output..." maxHeight="32rem" />
    </div>
  );
}
