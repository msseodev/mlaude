'use client';

import { useState } from 'react';
import { MarkdownOutput } from '@/components/auto/MarkdownOutput';

interface PipelineAgent {
  id: string;
  name: string;
  status: string; // 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
}

interface PipelineViewerProps {
  cycleNumber: number;
  agents: PipelineAgent[];
  currentAgentId: string | null;
  output: Array<{ type: string; text: string }>;
  outputRef: React.RefObject<HTMLDivElement | null>;
  autoScrollRef: React.MutableRefObject<boolean>;
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

export function PipelineViewer({ cycleNumber, agents, currentAgentId, output, outputRef, autoScrollRef }: PipelineViewerProps) {
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);

  // Show current running agent's output by default
  const activeAgentId = selectedAgent || currentAgentId || (agents.length > 0 ? agents[0].id : null);

  function handleScroll() {
    const el = outputRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    autoScrollRef.current = atBottom;
  }

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

      {/* Output viewer */}
      <div
        ref={outputRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto whitespace-pre-wrap break-words rounded-lg p-4 font-mono text-sm leading-relaxed"
        style={{ backgroundColor: '#1E1E1E', minHeight: 300 }}
      >
        {output.length === 0 ? (
          <p className="text-gray-500">Waiting for output...</p>
        ) : (
          output.map((entry, i) => {
            let color = 'text-gray-100';
            if (entry.type === 'tool_start' || entry.type === 'tool_end') color = 'text-blue-400';
            else if (entry.type === 'cycle_start' || entry.type === 'phase_change' || entry.type === 'agent_start') color = 'text-green-400 font-bold';
            else if (entry.type === 'cycle_complete' || entry.type === 'agent_complete') color = 'text-green-400';
            else if (entry.type === 'cycle_failed' || entry.type === 'agent_failed') color = 'text-red-400';
            else if (entry.type === 'review_iteration') color = 'text-yellow-400';
            if (entry.type === 'text') {
              return <MarkdownOutput key={i} text={entry.text} />;
            }
            return <span key={i} className={color}>{entry.text}</span>;
          })
        )}
      </div>
    </div>
  );
}
