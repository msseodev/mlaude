'use client';

import { useState, useEffect, useCallback, Fragment } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import type { AutoCycle, AutoSession, AutoCycleStatus, AutoAgentRun } from '@/types';

type BadgeVariant = 'gray' | 'blue' | 'green' | 'yellow' | 'red' | 'purple';

function cycleStatusBadgeVariant(status: AutoCycleStatus): BadgeVariant {
  switch (status) {
    case 'completed': return 'green';
    case 'failed': return 'red';
    case 'rolled_back': return 'yellow';
    case 'rate_limited': return 'yellow';
    case 'running': return 'blue';
    default: return 'gray';
  }
}

function formatDuration(ms: number | null) {
  if (ms == null) return '-';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString();
}

function agentRunStatusVariant(status: string): BadgeVariant {
  switch (status) {
    case 'completed': return 'green';
    case 'failed': return 'red';
    case 'running': return 'blue';
    case 'skipped': return 'yellow';
    default: return 'gray';
  }
}

export default function CyclesPage() {
  const [sessions, setSessions] = useState<AutoSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [cycles, setCycles] = useState<AutoCycle[]>([]);
  const [loading, setLoading] = useState(true);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCycle, setSelectedCycle] = useState<AutoCycle | null>(null);
  const [expandedCycleId, setExpandedCycleId] = useState<string | null>(null);
  const [agentRuns, setAgentRuns] = useState<AutoAgentRun[]>([]);
  const [agentRunsLoading, setAgentRunsLoading] = useState(false);
  const [selectedAgentRun, setSelectedAgentRun] = useState<AutoAgentRun | null>(null);
  const [agentRunDetail, setAgentRunDetail] = useState<AutoAgentRun | null>(null);
  const [agentRunDetailLoading, setAgentRunDetailLoading] = useState(false);
  const [promptExpanded, setPromptExpanded] = useState(false);

  // Fetch sessions
  const fetchSessions = useCallback(() => {
    fetch('/api/auto/sessions')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load sessions');
        return res.json();
      })
      .then((data: AutoSession[]) => {
        setSessions(data);
        if (data.length > 0) {
          setSelectedSessionId((prev) => prev ?? data[0].id);
        }
      })
      .catch(() => {
        setError('Failed to load sessions. Please try again.');
      })
      .finally(() => setSessionsLoading(false));
  }, []);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  // Fetch cycles for selected session
  const fetchCycles = useCallback(async () => {
    if (!selectedSessionId) return;
    try {
      const res = await fetch(`/api/auto/cycles?sessionId=${selectedSessionId}`);
      if (!res.ok) throw new Error('Failed to load cycles');
      const data: AutoCycle[] = await res.json();
      setCycles(data);
    } catch {
      setError('Failed to load cycle history. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [selectedSessionId]);

  useEffect(() => {
    if (!selectedSessionId) {
      setCycles([]);
      setLoading(false);
      return;
    }
    setError(null);
    setLoading(true);
    let cancelled = false;
    fetchCycles().then(() => {
      if (cancelled) return;
    });
    return () => { cancelled = true; };
  }, [selectedSessionId, fetchCycles]);

  const toggleExpandCycle = useCallback(async (cycle: AutoCycle) => {
    if (cycle.phase !== 'pipeline') {
      setExpandedCycleId(null);
      setSelectedCycle(cycle);
      return;
    }

    if (expandedCycleId === cycle.id) {
      setExpandedCycleId(null);
      setAgentRuns([]);
      return;
    }

    setExpandedCycleId(cycle.id);
    setAgentRunsLoading(true);
    try {
      const res = await fetch(`/api/auto/agent-runs?cycleId=${cycle.id}`);
      if (!res.ok) throw new Error('Failed to load agent runs');
      const data: AutoAgentRun[] = await res.json();
      setAgentRuns(data);
    } catch {
      setAgentRuns([]);
    } finally {
      setAgentRunsLoading(false);
    }
  }, [expandedCycleId]);

  const handleAgentRunClick = useCallback(async (run: AutoAgentRun) => {
    setSelectedAgentRun(run);
    setAgentRunDetail(null);
    setAgentRunDetailLoading(true);
    setPromptExpanded(false);
    try {
      const res = await fetch(`/api/auto/agent-runs/${run.id}`);
      if (!res.ok) throw new Error('Failed to load agent run detail');
      const data: AutoAgentRun = await res.json();
      setAgentRunDetail(data);
    } catch {
      setAgentRunDetail(null);
    } finally {
      setAgentRunDetailLoading(false);
    }
  }, []);

  return (
    <div className="p-6">
      <h1 className="mb-6 text-2xl font-bold text-gray-900">Cycle History</h1>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex items-center justify-between">
          <span>{error}</span>
          <button
            onClick={() => {
              setError(null);
              fetchCycles();
            }}
            className="font-medium text-red-700 hover:text-red-900 underline"
          >
            Retry
          </button>
        </div>
      )}

      {/* Session selector */}
      <div className="mb-4 flex items-center gap-3">
        <label className="text-sm font-medium text-gray-600">Session</label>
        {sessionsLoading ? (
          <span className="text-sm text-gray-500">Loading sessions...</span>
        ) : sessions.length === 0 ? (
          <span className="text-sm text-gray-500">No sessions found</span>
        ) : (
          <select
            value={selectedSessionId ?? ''}
            onChange={(e) => setSelectedSessionId(e.target.value || null)}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            {sessions.map((session) => (
              <option key={session.id} value={session.id}>
                {session.target_project} - {session.status} (
                {formatDate(session.created_at)})
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        {loading ? (
          <div className="px-6 py-12 text-center text-sm text-gray-500">
            Loading...
          </div>
        ) : cycles.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-gray-500">
            No cycles yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="px-6 py-3 font-medium text-gray-600">#</th>
                  <th className="px-6 py-3 font-medium text-gray-600">
                    Phase
                  </th>
                  <th className="px-6 py-3 font-medium text-gray-600">
                    Finding ID
                  </th>
                  <th className="px-6 py-3 font-medium text-gray-600">
                    Status
                  </th>
                  <th className="px-6 py-3 font-medium text-gray-600">
                    Cost
                  </th>
                  <th className="px-6 py-3 font-medium text-gray-600">
                    Duration
                  </th>
                  <th className="px-6 py-3 font-medium text-gray-600">
                    Started
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {cycles.map((cycle) => {
                  const isExpanded = expandedCycleId === cycle.id;
                  const isPipeline = cycle.phase === 'pipeline';
                  return (
                    <Fragment key={cycle.id}>
                      <tr
                        className="cursor-pointer hover:bg-gray-50"
                        onClick={() => toggleExpandCycle(cycle)}
                      >
                        <td className="px-6 py-3 font-medium text-gray-900">
                          <span className="flex items-center gap-1">
                            {isPipeline && (
                              <span className="text-gray-400">{isExpanded ? '\u25BC' : '\u25B6'}</span>
                            )}
                            {cycle.cycle_number}
                          </span>
                        </td>
                        <td className="px-6 py-3 text-gray-600">
                          <Badge variant="purple">{cycle.phase}</Badge>
                        </td>
                        <td className="px-6 py-3 font-mono text-xs text-gray-500">
                          {cycle.finding_id
                            ? cycle.finding_id.slice(0, 8)
                            : '-'}
                        </td>
                        <td className="px-6 py-3">
                          <Badge variant={cycleStatusBadgeVariant(cycle.status)}>
                            {cycle.status}
                          </Badge>
                        </td>
                        <td className="px-6 py-3 text-gray-600">
                          {cycle.cost_usd != null
                            ? `$${cycle.cost_usd.toFixed(4)}`
                            : '-'}
                        </td>
                        <td className="px-6 py-3 text-gray-600">
                          {formatDuration(cycle.duration_ms)}
                        </td>
                        <td className="px-6 py-3 text-gray-600">
                          {formatDate(cycle.started_at)}
                        </td>
                      </tr>
                      {isPipeline && isExpanded && (
                        <tr>
                          <td colSpan={7} className="bg-gray-50 px-6 py-3">
                            {agentRunsLoading ? (
                              <p className="text-sm text-gray-500">Loading agent runs...</p>
                            ) : agentRuns.length === 0 ? (
                              <p className="text-sm text-gray-500">No agent runs found.</p>
                            ) : (
                              <table className="w-full text-left text-sm">
                                <thead>
                                  <tr className="border-b border-gray-200">
                                    <th className="px-4 py-2 font-medium text-gray-600">Agent</th>
                                    <th className="px-4 py-2 font-medium text-gray-600">Iteration</th>
                                    <th className="px-4 py-2 font-medium text-gray-600">Status</th>
                                    <th className="px-4 py-2 font-medium text-gray-600">Cost</th>
                                    <th className="px-4 py-2 font-medium text-gray-600">Duration</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                  {agentRuns.map((run) => (
                                    <tr
                                      key={run.id}
                                      className="cursor-pointer hover:bg-gray-100"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleAgentRunClick(run);
                                      }}
                                    >
                                      <td className="px-4 py-2 text-gray-900">{run.agent_name}</td>
                                      <td className="px-4 py-2 text-gray-600">{run.iteration}</td>
                                      <td className="px-4 py-2">
                                        <Badge variant={agentRunStatusVariant(run.status)}>
                                          {run.status}
                                        </Badge>
                                      </td>
                                      <td className="px-4 py-2 text-gray-600">
                                        {run.cost_usd != null ? `$${run.cost_usd.toFixed(4)}` : '-'}
                                      </td>
                                      <td className="px-4 py-2 text-gray-600">
                                        {formatDuration(run.duration_ms)}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Cycle Detail Modal */}
      <Modal
        open={selectedCycle !== null}
        onClose={() => setSelectedCycle(null)}
        title="Cycle Detail"
        footer={
          <Button
            variant="secondary"
            onClick={() => setSelectedCycle(null)}
          >
            Close
          </Button>
        }
      >
        {selectedCycle && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-gray-500">Cycle:</span>{' '}
                <span className="font-medium text-gray-900">
                  #{selectedCycle.cycle_number}
                </span>
              </div>
              <div>
                <span className="text-gray-500">Status:</span>{' '}
                <Badge
                  variant={cycleStatusBadgeVariant(selectedCycle.status)}
                >
                  {selectedCycle.status}
                </Badge>
              </div>
              <div>
                <span className="text-gray-500">Phase:</span>{' '}
                <Badge variant="purple">{selectedCycle.phase}</Badge>
              </div>
              <div>
                <span className="text-gray-500">Cost:</span>{' '}
                <span className="text-gray-900">
                  {selectedCycle.cost_usd != null
                    ? `$${selectedCycle.cost_usd.toFixed(4)}`
                    : '-'}
                </span>
              </div>
              <div>
                <span className="text-gray-500">Duration:</span>{' '}
                <span className="text-gray-900">
                  {formatDuration(selectedCycle.duration_ms)}
                </span>
              </div>
              {selectedCycle.finding_id && (
                <div>
                  <span className="text-gray-500">Finding:</span>{' '}
                  <span className="font-mono text-xs text-gray-900">
                    {selectedCycle.finding_id.slice(0, 8)}
                  </span>
                </div>
              )}
              {selectedCycle.git_checkpoint && (
                <div className="col-span-2">
                  <span className="text-gray-500">Git Checkpoint:</span>{' '}
                  <span className="font-mono text-xs text-gray-900">
                    {selectedCycle.git_checkpoint}
                  </span>
                </div>
              )}
              {selectedCycle.test_total_count != null && (
                <div className="col-span-2">
                  <span className="text-gray-500">Tests:</span>{' '}
                  <span className="text-gray-900">
                    {selectedCycle.test_pass_count ?? 0} passed /{' '}
                    {selectedCycle.test_fail_count ?? 0} failed /{' '}
                    {selectedCycle.test_total_count} total
                  </span>
                </div>
              )}
            </div>
            {selectedCycle.prompt_used && (
              <div>
                <p className="mb-1 text-sm font-medium text-gray-700">
                  Prompt Used
                </p>
                <div className="max-h-40 overflow-y-auto rounded bg-gray-50 p-3 text-xs text-gray-800 whitespace-pre-wrap">
                  {selectedCycle.prompt_used}
                </div>
              </div>
            )}
            <div>
              <p className="mb-1 text-sm font-medium text-gray-700">Output</p>
              <div
                className="max-h-80 overflow-y-auto rounded p-3 font-mono text-xs leading-relaxed text-gray-100 whitespace-pre-wrap"
                style={{ backgroundColor: '#1E1E1E' }}
              >
                {selectedCycle.output || '(no output)'}
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* Agent Run Detail Modal */}
      <Modal
        open={selectedAgentRun !== null}
        onClose={() => {
          setSelectedAgentRun(null);
          setAgentRunDetail(null);
        }}
        title={
          selectedAgentRun
            ? `${selectedAgentRun.agent_name} - Iteration ${selectedAgentRun.iteration}`
            : 'Agent Run Detail'
        }
        footer={
          <Button
            variant="secondary"
            onClick={() => {
              setSelectedAgentRun(null);
              setAgentRunDetail(null);
            }}
          >
            Close
          </Button>
        }
      >
        {selectedAgentRun && (
          <div className="max-h-[70vh] overflow-y-auto space-y-4">
            {/* Header with status badge */}
            <div className="flex items-center gap-2">
              <Badge variant={agentRunStatusVariant(selectedAgentRun.status)}>
                {selectedAgentRun.status}
              </Badge>
            </div>

            {/* Metadata */}
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-gray-500">Cost:</span>{' '}
                <span className="text-gray-900">
                  {selectedAgentRun.cost_usd != null
                    ? `$${selectedAgentRun.cost_usd.toFixed(4)}`
                    : '-'}
                </span>
              </div>
              <div>
                <span className="text-gray-500">Duration:</span>{' '}
                <span className="text-gray-900">
                  {formatDuration(selectedAgentRun.duration_ms)}
                </span>
              </div>
              <div>
                <span className="text-gray-500">Started:</span>{' '}
                <span className="text-gray-900">
                  {formatDate(selectedAgentRun.started_at)}
                </span>
              </div>
              <div>
                <span className="text-gray-500">Completed:</span>{' '}
                <span className="text-gray-900">
                  {selectedAgentRun.completed_at
                    ? formatDate(selectedAgentRun.completed_at)
                    : '-'}
                </span>
              </div>
            </div>

            {/* Output section */}
            <div>
              <p className="mb-1 text-sm font-medium text-gray-700">Output</p>
              {agentRunDetailLoading ? (
                <div className="rounded p-3 text-sm text-gray-500" style={{ backgroundColor: '#1E1E1E' }}>
                  Loading...
                </div>
              ) : (
                <div
                  className="max-h-96 overflow-y-auto rounded p-3 font-mono text-xs leading-relaxed text-gray-100 whitespace-pre-wrap"
                  style={{ backgroundColor: '#1E1E1E' }}
                >
                  {agentRunDetail?.output || '(no output)'}
                </div>
              )}
            </div>

            {/* Prompt section (collapsible) */}
            <div>
              <button
                type="button"
                className="flex items-center gap-1 text-sm font-medium text-gray-700 hover:text-gray-900"
                onClick={() => setPromptExpanded((prev) => !prev)}
              >
                <span className="text-gray-400">{promptExpanded ? '\u25BC' : '\u25B6'}</span>
                Prompt
              </button>
              {promptExpanded && (
                <div className="mt-1 max-h-60 overflow-y-auto rounded bg-gray-50 p-3 text-xs text-gray-800 whitespace-pre-wrap">
                  {agentRunDetailLoading
                    ? 'Loading...'
                    : agentRunDetail?.prompt || '(no prompt)'}
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
