'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useSSE } from '@/hooks/useSSE';
import { useAutoStatus } from '@/hooks/useAutoStatus';
import { Button } from '@/components/ui/Button';
import { Badge, statusBadgeVariant } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { PipelineViewer } from '@/components/auto/PipelineViewer';
import { MarkdownOutput } from '@/components/auto/MarkdownOutput';
import { RateLimitBanner } from '@/components/RateLimitBanner';
import type { AutoSSEEvent, AutoUserPrompt } from '@/types';

const MAX_OUTPUT_ENTRIES = 10000;

interface RecentCycle {
  cycle_number: number;
  phase: string;
  finding_id: string | null;
  status: string;
  cost_usd: number | null;
  duration_ms: number | null;
}

interface ParallelAgentInfo {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
}

interface ParallelCycleInfo {
  id: string;
  number: number;
  findingTitle: string;
  agentName: string;
  status: 'running' | 'completed' | 'failed';
  agents: ParallelAgentInfo[];
}

export default function AutoDashboardPage() {
  const { status, refresh } = useAutoStatus();
  const { showToast } = useToast();
  const [output, setOutput] = useState<Array<{ type: string; text: string }>>([]);
  const [actionLoading, setActionLoading] = useState(false);
  const [recentCycles, setRecentCycles] = useState<RecentCycle[]>([]);

  // Modal state
  const [showStartModal, setShowStartModal] = useState(false);
  const [showResumeModal, setShowResumeModal] = useState(false);
  const [showAddPromptModal, setShowAddPromptModal] = useState(false);

  // Pipeline state
  const [pipelineAgents, setPipelineAgents] = useState<Array<{ id: string; name: string; status: string }>>([]);
  const [currentAgentId, setCurrentAgentId] = useState<string | null>(null);

  // Parallel batch state
  const [isParallelBatch, setIsParallelBatch] = useState(false);
  const [parallelCycles, setParallelCycles] = useState<ParallelCycleInfo[]>([]);
  const [entriesByCycle, setEntriesByCycle] = useState<Record<string, Array<{ type: string; text: string }>>>({});
  const [activeParallelTab, setActiveParallelTab] = useState<string | null>(null);

  const outputRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);
  const fetchCyclesRef = useRef<() => void>(() => {});

  const sessionStatus = status?.status ?? 'idle';

  // Sync pipeline agents from status
  useEffect(() => {
    if (status?.pipelineAgents && status.pipelineAgents.length > 0) {
      setPipelineAgents(status.pipelineAgents);
    }
    if (status?.currentAgent) {
      setCurrentAgentId(status.currentAgent.id);
    }
  }, [status?.pipelineAgents, status?.currentAgent]);

  // Fetch recent cycles
  const fetchRecentCycles = useCallback(async () => {
    if (!status?.sessionId) return;
    try {
      const res = await fetch(`/api/auto/cycles?sessionId=${status.sessionId}&limit=10`);
      if (res.ok) {
        const data = await res.json();
        setRecentCycles(data);
      }
    } catch {
      // ignore
    }
  }, [status?.sessionId]);

  useEffect(() => {
    fetchCyclesRef.current = fetchRecentCycles;
  }, [fetchRecentCycles]);

  // Helper: append an entry to a specific cycle's entries (for parallel mode)
  const appendToCycleEntries = useCallback(
    (cycleId: string, entry: { type: string; text: string }) => {
      setEntriesByCycle((prev) => {
        const existing = prev[cycleId] ?? [];
        const next = [...existing, entry];
        return {
          ...prev,
          [cycleId]: next.length > MAX_OUTPUT_ENTRIES ? next.slice(-MAX_OUTPUT_ENTRIES) : next,
        };
      });
    },
    []
  );

  // Helper: coalesce text_delta into a cycle's entries (for parallel mode)
  const appendTextToCycleEntries = useCallback(
    (cycleId: string, text: string) => {
      setEntriesByCycle((prev) => {
        const existing = prev[cycleId] ?? [];
        if (existing.length > 0 && existing[existing.length - 1].type === 'text') {
          const updated = [...existing];
          updated[updated.length - 1] = {
            type: 'text',
            text: updated[updated.length - 1].text + text,
          };
          return {
            ...prev,
            [cycleId]: updated.length > MAX_OUTPUT_ENTRIES ? updated.slice(-MAX_OUTPUT_ENTRIES) : updated,
          };
        }
        const next = [...existing, { type: 'text', text }];
        return {
          ...prev,
          [cycleId]: next.length > MAX_OUTPUT_ENTRIES ? next.slice(-MAX_OUTPUT_ENTRIES) : next,
        };
      });
    },
    []
  );

  // Use a ref to track parallel state inside the SSE callback without stale closures
  const isParallelBatchRef = useRef(false);
  useEffect(() => {
    isParallelBatchRef.current = isParallelBatch;
  }, [isParallelBatch]);

  // SSE event handler
  const handleSSEEvent = useCallback(
    (event: AutoSSEEvent) => {
      const cycleId = event.data.cycleId ? String(event.data.cycleId) : null;
      const isParallel = isParallelBatchRef.current;

      switch (event.type) {
        case 'parallel_batch_start': {
          setIsParallelBatch(true);
          isParallelBatchRef.current = true;
          setParallelCycles([]);
          setEntriesByCycle({});
          setActiveParallelTab(null);
          setOutput([]);
          break;
        }
        case 'parallel_batch_complete': {
          setIsParallelBatch(false);
          isParallelBatchRef.current = false;
          refresh();
          fetchCyclesRef.current();
          break;
        }
        case 'text_delta': {
          const text = String(event.data.text ?? '');
          if (isParallel && cycleId) {
            appendTextToCycleEntries(cycleId, text);
          } else {
            setOutput((prev) => {
              if (prev.length > 0 && prev[prev.length - 1].type === 'text') {
                const updated = [...prev];
                updated[updated.length - 1] = {
                  type: 'text',
                  text: updated[updated.length - 1].text + text,
                };
                return updated.length > MAX_OUTPUT_ENTRIES
                  ? updated.slice(-MAX_OUTPUT_ENTRIES)
                  : updated;
              }
              const next = [...prev, { type: 'text', text }];
              return next.length > MAX_OUTPUT_ENTRIES
                ? next.slice(-MAX_OUTPUT_ENTRIES)
                : next;
            });
          }
          break;
        }
        case 'tool_start': {
          const name = String(event.data.name ?? 'tool');
          const entry = { type: 'tool_start', text: `--- Tool: ${name} ---` };
          if (isParallel && cycleId) {
            appendToCycleEntries(cycleId, entry);
          } else {
            setOutput((prev) => [...prev, entry]);
          }
          break;
        }
        case 'tool_end': {
          const name = String(event.data.name ?? 'tool');
          const entry = { type: 'tool_end', text: `--- End: ${name} ---` };
          if (isParallel && cycleId) {
            appendToCycleEntries(cycleId, entry);
          } else {
            setOutput((prev) => [...prev, entry]);
          }
          break;
        }
        case 'cycle_start': {
          const cycleNumber = event.data.cycleNumber ?? event.data.cycle_number ?? '?';
          const phase = event.data.phase ?? '';
          const isParallelCycle = !!event.data.parallel;

          if (isParallelCycle && cycleId) {
            const findingTitle = String(event.data.findingTitle ?? '');
            setParallelCycles((prev) => {
              if (prev.some((c) => c.id === cycleId)) return prev;
              return [
                ...prev,
                {
                  id: cycleId,
                  number: Number(cycleNumber),
                  findingTitle,
                  agentName: '',
                  status: 'running',
                  agents: [],
                },
              ];
            });
            setEntriesByCycle((prev) => ({
              ...prev,
              [cycleId]: [
                {
                  type: 'cycle_start',
                  text: `\n========== Cycle #${cycleNumber} — Pipeline ==========\n`,
                },
              ],
            }));
            // Auto-select first tab
            setActiveParallelTab((prev) => prev ?? cycleId);
          } else {
            setOutput([
              { type: 'cycle_start', text: `\n========== Cycle #${cycleNumber} — ${phase === 'pipeline' ? 'Pipeline' : `Phase: ${phase}`} ==========\n` },
            ]);
            if (phase === 'pipeline') {
              refresh().then(() => {
                // Pipeline agents will be set from status via useEffect
              });
            }
          }
          refresh();
          break;
        }
        case 'cycle_complete':
        case 'cycle_failed': {
          const label = event.type === 'cycle_complete' ? 'COMPLETED' : 'FAILED';
          const cycleNumber = event.data.cycleNumber ?? event.data.cycle_number ?? '?';
          const isParallelCycle = !!event.data.parallel;

          if (isParallelCycle && cycleId) {
            // Remove completed/failed cycle from tabs
            setParallelCycles((prev) => prev.filter((c) => c.id !== cycleId));
            setEntriesByCycle((prev) => {
              const next = { ...prev };
              delete next[cycleId];
              return next;
            });
            // If the removed tab was active, switch to next running tab
            setActiveParallelTab((prev) => {
              if (prev !== cycleId) return prev;
              return null; // will auto-select first remaining tab
            });
            appendToCycleEntries(cycleId, {
              type: event.type,
              text: `\n========== ${label}: Cycle #${cycleNumber} ==========\n`,
            });
          } else {
            setOutput((prev) => [
              ...prev,
              { type: event.type, text: `\n========== ${label}: Cycle #${cycleNumber} ==========\n` },
            ]);
          }
          refresh();
          fetchCyclesRef.current();
          break;
        }
        case 'finding_created':
        case 'finding_resolved':
        case 'finding_failed':
          refresh();
          break;
        case 'phase_change': {
          const phase = event.data.phase ?? '';
          const entry = { type: 'phase_change', text: `\n--- Phase: ${phase} ---\n` };
          if (isParallel && cycleId) {
            appendToCycleEntries(cycleId, entry);
          } else {
            setOutput((prev) => [...prev, entry]);
          }
          refresh();
          break;
        }
        case 'agent_start': {
          const agentId = String(event.data.agentId ?? '');
          const agentName = String(event.data.agentName ?? '');
          const entry = { type: 'agent_start', text: `\n--- Agent: ${agentName} (running) ---\n` };

          if (isParallel && cycleId) {
            appendToCycleEntries(cycleId, entry);
            setParallelCycles((prev) =>
              prev.map((c) => {
                if (c.id !== cycleId) return c;
                const agents = c.agents.some(a => a.id === agentId)
                  ? c.agents.map(a => a.id === agentId ? { ...a, status: 'running' as const } : a)
                  : [...c.agents, { id: agentId, name: agentName, status: 'running' as const }];
                return { ...c, agentName, agents };
              })
            );
          } else {
            setCurrentAgentId(agentId);
            setPipelineAgents(prev => prev.map(a =>
              a.id === agentId ? { ...a, status: 'running' } : a
            ));
            setOutput(prev => [...prev, entry]);
          }
          break;
        }
        case 'agent_complete': {
          const agentId = String(event.data.agentId ?? '');
          const agentName = String(event.data.agentName ?? '');
          const entry = { type: 'agent_complete', text: `\n--- Agent: ${agentName} (completed) ---\n` };

          if (isParallel && cycleId) {
            appendToCycleEntries(cycleId, entry);
            setParallelCycles((prev) =>
              prev.map((c) =>
                c.id === cycleId
                  ? { ...c, agents: c.agents.map(a => a.id === agentId ? { ...a, status: 'completed' as const } : a) }
                  : c
              )
            );
          } else {
            setPipelineAgents(prev => prev.map(a =>
              a.id === agentId ? { ...a, status: 'completed' } : a
            ));
            setOutput(prev => [...prev, entry]);
          }
          refresh();
          break;
        }
        case 'agent_failed': {
          const agentId = String(event.data.agentId ?? '');
          const agentName = String(event.data.agentName ?? '');
          const entry = { type: 'agent_failed', text: `\n--- Agent: ${agentName} (FAILED) ---\n` };

          if (isParallel && cycleId) {
            appendToCycleEntries(cycleId, entry);
            setParallelCycles((prev) =>
              prev.map((c) =>
                c.id === cycleId
                  ? { ...c, agents: c.agents.map(a => a.id === agentId ? { ...a, status: 'failed' as const } : a) }
                  : c
              )
            );
          } else {
            setPipelineAgents(prev => prev.map(a =>
              a.id === agentId ? { ...a, status: 'failed' } : a
            ));
            setOutput(prev => [...prev, entry]);
          }
          refresh();
          break;
        }
        case 'review_iteration': {
          const iteration = event.data.iteration ?? '?';
          const maxIterations = event.data.maxIterations ?? '?';
          const entry = { type: 'review_iteration', text: `\n--- Review Iteration ${iteration}/${maxIterations} ---\n` };
          if (isParallel && cycleId) {
            appendToCycleEntries(cycleId, entry);
          } else {
            setOutput(prev => [...prev, entry]);
          }
          break;
        }
        case 'user_prompt_added': {
          showToast('New prompt added', 'info');
          break;
        }
        case 'rate_limit':
        case 'session_status':
        case 'error':
        case 'test_result':
        case 'git_checkpoint':
        case 'git_rollback':
          refresh();
          break;
      }
    },
    [refresh, showToast, appendToCycleEntries, appendTextToCycleEntries]
  );

  const handleReconnect = useCallback(() => {
    setOutput([]); // Clear on reconnection to prevent duplicates
    setIsParallelBatch(false);
    isParallelBatchRef.current = false;
    setParallelCycles([]);
    setEntriesByCycle({});
    setActiveParallelTab(null);
    refresh();
  }, [refresh]);

  // SSE connection -- cast handler since useSSE expects SSEEvent but we handle AutoSSEEvent
  const { connected } = useSSE(
    '/api/auto/stream',
    handleSSEEvent as unknown as (event: import('@/types').SSEEvent) => void,
    handleReconnect
  );

  useEffect(() => {
    fetchRecentCycles();
  }, [fetchRecentCycles]);

  // Auto-scroll output (triggers on single-stream output or parallel entries)
  useEffect(() => {
    const el = outputRef.current;
    if (el && autoScrollRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [output, entriesByCycle, activeParallelTab]);

  // Control handlers
  async function handleStart(targetProject?: string, initialPrompt?: string, forceDiscovery?: boolean) {
    setActionLoading(true);
    try {
      const res = await fetch('/api/auto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetProject, initialPrompt, forceDiscovery }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast(data.error || 'Failed to start', 'error');
        return;
      }
      showToast('Autonomous mode started', 'success');
      setOutput([]);
      setPipelineAgents([]);
      setIsParallelBatch(false);
      isParallelBatchRef.current = false;
      setParallelCycles([]);
      setEntriesByCycle({});
      setActiveParallelTab(null);
      await refresh();
    } catch {
      showToast('Failed to start autonomous mode', 'error');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleStop() {
    setActionLoading(true);
    try {
      const res = await fetch('/api/auto', { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast(data.error || 'Failed to stop', 'error');
      } else {
        showToast('Autonomous mode stopped', 'success');
      }
      await refresh();
    } catch {
      showToast('Failed to stop', 'error');
    } finally {
      setActionLoading(false);
    }
  }

  async function handlePause() {
    setActionLoading(true);
    try {
      const res = await fetch('/api/auto', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'pause' }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast(data.error || 'Failed to pause', 'error');
      } else {
        showToast('Paused', 'success');
      }
      await refresh();
    } catch {
      showToast('Failed to pause', 'error');
    } finally {
      setActionLoading(false);
    }
  }

  async function handlePauseAfterCycle() {
    setActionLoading(true);
    try {
      const res = await fetch('/api/auto', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'pause_after_cycle' }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast(data.error || 'Failed to schedule pause', 'error');
      } else {
        showToast('Will pause after current cycle completes', 'info');
      }
      await refresh();
    } catch {
      showToast('Failed to schedule pause', 'error');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleCancelPauseAfterCycle() {
    setActionLoading(true);
    try {
      const res = await fetch('/api/auto', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel_pause_after_cycle' }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast(data.error || 'Failed to cancel pause', 'error');
      } else {
        showToast('Pause cancelled, will continue running', 'info');
      }
      await refresh();
    } catch {
      showToast('Failed to cancel pause', 'error');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleResume(midSessionPrompt?: string) {
    setActionLoading(true);
    try {
      const res = await fetch('/api/auto', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'resume', midSessionPrompt }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast(data.error || 'Failed to resume', 'error');
      } else {
        showToast('Resumed', 'success');
      }
      await refresh();
    } catch {
      showToast('Failed to resume', 'error');
    } finally {
      setActionLoading(false);
    }
  }

  const canStart = sessionStatus === 'idle' || sessionStatus === 'completed' || sessionStatus === 'stopped';

  return (
    <div className="flex h-full flex-col p-6">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-900">Autonomous Mode</h1>
          <Badge variant={statusBadgeVariant(sessionStatus)}>
            {sessionStatus}
          </Badge>
          {connected && sessionStatus === 'running' && (
            <span className="inline-flex items-center gap-1 text-xs text-green-600">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-500" />
              Live
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {canStart && (
            <Button onClick={() => setShowStartModal(true)} loading={actionLoading} variant="success">
              Start
            </Button>
          )}
          {sessionStatus === 'running' && (
            <>
              <Button variant="secondary" onClick={() => setShowAddPromptModal(true)}>
                Add Prompt
              </Button>
              {status?.pauseAfterCycle ? (
                <Button variant="secondary" onClick={handleCancelPauseAfterCycle} loading={actionLoading}>
                  Cancel Pause
                </Button>
              ) : (
                <Button variant="secondary" onClick={handlePauseAfterCycle} loading={actionLoading}>
                  Pause After Cycle
                </Button>
              )}
              <Button variant="secondary" onClick={handlePause} loading={actionLoading}>
                Pause Now
              </Button>
              <Button variant="danger" onClick={handleStop} loading={actionLoading}>
                Stop
              </Button>
            </>
          )}
          {sessionStatus === 'paused' && (
            <>
              <Button onClick={() => setShowResumeModal(true)} loading={actionLoading} variant="success">
                Resume
              </Button>
              <Button variant="danger" onClick={handleStop} loading={actionLoading}>
                Stop
              </Button>
            </>
          )}
          {sessionStatus === 'waiting_for_limit' && (
            <Button onClick={handleStop} loading={actionLoading} variant="danger">
              Stop
            </Button>
          )}
        </div>
      </div>

      {/* Stats Cards */}
      <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Cycles" value={status?.stats.totalCycles ?? 0} />
        <StatCard label="Open Findings" value={status?.stats.findingsOpen ?? 0} />
        <StatCard label="Resolved" value={status?.stats.findingsResolved ?? 0} />
        <StatCard label="Total Cost" value={`$${(status?.stats.totalCostUsd ?? 0).toFixed(2)}`} />
      </div>

      {/* Rate Limit Banner */}
      {sessionStatus === 'waiting_for_limit' && status?.waitingUntil && (
        <RateLimitBanner
          waitingUntil={status.waitingUntil}
          retryCount={status.retryCount}
        />
      )}

      {/* Current Cycle Panel / Pipeline Viewer / Parallel Tabs */}
      {sessionStatus !== 'idle' && (
        isParallelBatch && parallelCycles.length > 0 ? (
          <ParallelBatchViewer
            cycles={parallelCycles}
            entriesByCycle={entriesByCycle}
            activeTab={activeParallelTab}
            onTabChange={setActiveParallelTab}
            outputRef={outputRef}
            autoScrollRef={autoScrollRef}
          />
        ) : pipelineAgents.length > 0 ? (
          <PipelineViewer
            cycleNumber={status?.currentCycle ?? 0}
            agents={pipelineAgents}
            currentAgentId={currentAgentId}
            output={output}
            outputRef={outputRef}
            autoScrollRef={autoScrollRef}
          />
        ) : (
          <div className="mb-4">
            <div className="mb-2 flex items-center gap-2">
              <h2 className="text-sm font-medium text-gray-700">
                Cycle #{status?.currentCycle ?? 0} — Phase: {status?.currentPhase ?? '\u2014'}
              </h2>
              {status?.currentFinding && (
                <span className="text-xs text-gray-500">
                  Finding: {status.currentFinding.title}
                </span>
              )}
            </div>
            <OutputViewer entries={output} outputRef={outputRef} autoScrollRef={autoScrollRef} />
          </div>
        )
      )}

      {/* Recent Cycles Table */}
      {recentCycles.length > 0 && (
        <div className="mt-2">
          <h2 className="mb-3 text-lg font-semibold text-gray-900">Recent Cycles</h2>
          <div className="overflow-hidden rounded-lg border border-gray-200">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">#</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Phase</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Finding</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Status</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Cost</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Duration</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {recentCycles.map((cycle, i) => (
                  <tr key={`${cycle.cycle_number}-${cycle.phase}-${i}`}>
                    <td className="px-4 py-2 text-sm text-gray-900">{cycle.cycle_number}</td>
                    <td className="px-4 py-2 text-sm text-gray-600">{cycle.phase}</td>
                    <td className="px-4 py-2 text-sm text-gray-600">
                      {cycle.finding_id ? cycle.finding_id.slice(0, 8) : '\u2014'}
                    </td>
                    <td className="px-4 py-2">
                      <Badge variant={statusBadgeVariant(cycle.status)}>{cycle.status}</Badge>
                    </td>
                    <td className="px-4 py-2 text-sm text-gray-600">
                      {cycle.cost_usd != null ? `$${cycle.cost_usd.toFixed(2)}` : '\u2014'}
                    </td>
                    <td className="px-4 py-2 text-sm text-gray-600">
                      {cycle.duration_ms != null ? `${(cycle.duration_ms / 1000).toFixed(1)}s` : '\u2014'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Start Modal */}
      <StartAutoModal
        open={showStartModal}
        onClose={() => setShowStartModal(false)}
        onStart={handleStart}
        loading={actionLoading}
      />

      {/* Resume Modal */}
      <ResumeAutoModal
        open={showResumeModal}
        onClose={() => setShowResumeModal(false)}
        onResume={handleResume}
        loading={actionLoading}
        sessionId={status?.sessionId ?? null}
      />

      {/* Add Prompt Modal */}
      <AddPromptModal
        open={showAddPromptModal}
        onClose={() => setShowAddPromptModal(false)}
        onAdd={async (content: string, activeForCycles?: number) => {
          try {
            const res = await fetch('/api/auto/prompts', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ content, activeForCycles }),
            });
            if (!res.ok) {
              const data = await res.json().catch(() => ({}));
              showToast(data.error || 'Failed to add prompt', 'error');
              return;
            }
            showToast('Prompt added', 'success');
            setShowAddPromptModal(false);
          } catch {
            showToast('Failed to add prompt', 'error');
          }
        }}
      />
    </div>
  );
}

// --- StartAutoModal ---

function StartAutoModal({
  open,
  onClose,
  onStart,
  loading,
}: {
  open: boolean;
  onClose: () => void;
  onStart: (targetProject?: string, initialPrompt?: string, forceDiscovery?: boolean) => Promise<void>;
  loading: boolean;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Start Autonomous Mode"
      size="lg"
    >
      {open && (
        <StartAutoModalContent onClose={onClose} onStart={onStart} loading={loading} />
      )}
    </Modal>
  );
}

function StartAutoModalContent({
  onClose,
  onStart,
  loading,
}: {
  onClose: () => void;
  onStart: (targetProject?: string, initialPrompt?: string, forceDiscovery?: boolean) => Promise<void>;
  loading: boolean;
}) {
  const [targetProject, setTargetProject] = useState('');
  const [initialPrompt, setInitialPrompt] = useState('');
  const [forceDiscovery, setForceDiscovery] = useState(true);
  const [openFindingsCount, setOpenFindingsCount] = useState<number | null>(null);

  // Load target_project from settings on mount
  useEffect(() => {
    let cancelled = false;
    fetch('/api/auto/settings')
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (!cancelled && data?.target_project) {
          setTargetProject(data.target_project);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Load actionable findings count on mount (open + in_progress)
  useEffect(() => {
    let cancelled = false;
    fetch('/api/auto/findings?limit=500')
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (!cancelled && Array.isArray(data)) {
          const actionable = data.filter(
            (f: { status: string }) => f.status === 'open' || f.status === 'in_progress'
          );
          setOpenFindingsCount(actionable.length);
          if (actionable.length === 0) {
            setForceDiscovery(true);
          }
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  async function handleSubmit() {
    onClose();
    await onStart(
      targetProject.trim() || undefined,
      initialPrompt.trim() || undefined,
      forceDiscovery,
    );
  }

  return (
    <>
      <div className="space-y-4">
        <div>
          <label htmlFor="start-target-project" className="mb-1 block text-sm font-medium text-gray-700">
            Target Project
          </label>
          <input
            id="start-target-project"
            type="text"
            value={targetProject}
            onChange={(e) => setTargetProject(e.target.value)}
            placeholder="/path/to/your/project"
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <p className="mt-1 text-xs text-gray-500">
            Path to the project to analyze and improve
          </p>
        </div>
        <div>
          <label htmlFor="start-initial-prompt" className="mb-1 block text-sm font-medium text-gray-700">
            Initial Prompt (optional)
          </label>
          <textarea
            id="start-initial-prompt"
            value={initialPrompt}
            onChange={(e) => setInitialPrompt(e.target.value)}
            placeholder="What do you want to build?"
            rows={4}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <p className="mt-1 text-xs text-gray-500">
            Guide the autonomous mode with a specific goal or instruction
          </p>
        </div>

        {/* First Cycle Mode */}
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-sm font-medium text-gray-700">First Cycle: Discovery</span>
              <p className="text-xs text-gray-500">
                {forceDiscovery
                  ? 'Analyze codebase first, then fix findings'
                  : 'Skip discovery, start fixing existing findings'}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={forceDiscovery}
              disabled={openFindingsCount === 0}
              onClick={() => setForceDiscovery(!forceDiscovery)}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                forceDiscovery ? 'bg-blue-600' : 'bg-gray-200'
              } ${openFindingsCount === 0 ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                  forceDiscovery ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
          {openFindingsCount !== null && (
            <p className={`mt-2 text-xs ${openFindingsCount > 0 ? 'text-amber-600' : 'text-gray-400'}`}>
              {openFindingsCount > 0
                ? `${openFindingsCount} open finding${openFindingsCount !== 1 ? 's' : ''} remaining`
                : 'No open findings'}
            </p>
          )}
        </div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="success" onClick={handleSubmit} loading={loading}>Start</Button>
      </div>
    </>
  );
}

// --- ResumeAutoModal ---

function ResumeAutoModal({
  open,
  onClose,
  onResume,
  loading,
  sessionId,
}: {
  open: boolean;
  onClose: () => void;
  onResume: (midSessionPrompt?: string) => Promise<void>;
  loading: boolean;
  sessionId: string | null;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Resume Autonomous Mode"
      size="lg"
    >
      {open && (
        <ResumeAutoModalContent
          onClose={onClose}
          onResume={onResume}
          loading={loading}
          sessionId={sessionId}
        />
      )}
    </Modal>
  );
}

function ResumeAutoModalContent({
  onClose,
  onResume,
  loading,
  sessionId,
}: {
  onClose: () => void;
  onResume: (midSessionPrompt?: string) => Promise<void>;
  loading: boolean;
  sessionId: string | null;
}) {
  const [midSessionPrompt, setMidSessionPrompt] = useState('');
  const [previousPrompts, setPreviousPrompts] = useState<AutoUserPrompt[]>([]);
  const [promptsLoading, setPromptsLoading] = useState(!!sessionId);

  // Load previous prompts on mount
  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    fetch(`/api/auto/prompts?sessionId=${sessionId}`)
      .then((res) => res.ok ? res.json() : [])
      .then((data) => {
        if (!cancelled) {
          setPreviousPrompts(Array.isArray(data) ? data : []);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPreviousPrompts([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setPromptsLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [sessionId]);

  async function handleSubmit() {
    onClose();
    await onResume(midSessionPrompt.trim() || undefined);
  }

  return (
    <>
      <div className="space-y-4">
        {/* Previous prompts */}
        {previousPrompts.length > 0 && (
          <div>
            <p className="mb-2 text-sm font-medium text-gray-700">Previous Prompts</p>
            <div className="max-h-32 space-y-1 overflow-y-auto rounded-md border border-gray-200 bg-gray-50 p-2">
              {previousPrompts.map((p) => (
                <div key={p.id} className="text-xs text-gray-600">
                  <span className="font-medium text-gray-500">Cycle #{p.added_at_cycle}:</span>{' '}
                  {p.content.length > 100 ? p.content.slice(0, 100) + '...' : p.content}
                </div>
              ))}
            </div>
          </div>
        )}
        {promptsLoading && (
          <p className="text-xs text-gray-400">Loading previous prompts...</p>
        )}

        <div>
          <label htmlFor="resume-prompt" className="mb-1 block text-sm font-medium text-gray-700">
            New Prompt (optional)
          </label>
          <textarea
            id="resume-prompt"
            value={midSessionPrompt}
            onChange={(e) => setMidSessionPrompt(e.target.value)}
            placeholder="Add a new direction or instruction..."
            rows={4}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <p className="mt-1 text-xs text-gray-500">
            Optionally provide a prompt to guide the next cycle
          </p>
        </div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="success" onClick={handleSubmit} loading={loading}>Resume</Button>
      </div>
    </>
  );
}

// --- AddPromptModal ---

function AddPromptModal({
  open,
  onClose,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  onAdd: (content: string, activeForCycles?: number) => Promise<void>;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add Prompt"
      size="lg"
    >
      {open && (
        <AddPromptModalContent onClose={onClose} onAdd={onAdd} />
      )}
    </Modal>
  );
}

function AddPromptModalContent({
  onClose,
  onAdd,
}: {
  onClose: () => void;
  onAdd: (content: string, activeForCycles?: number) => Promise<void>;
}) {
  const [content, setContent] = useState('');
  const [activeForCycles, setActiveForCycles] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!content.trim()) return;
    setSubmitting(true);
    try {
      const cycles = activeForCycles ? parseInt(activeForCycles, 10) : undefined;
      await onAdd(content.trim(), cycles && cycles > 0 ? cycles : undefined);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <div className="space-y-4">
        <div>
          <label htmlFor="add-prompt-content" className="mb-1 block text-sm font-medium text-gray-700">
            Prompt
          </label>
          <textarea
            id="add-prompt-content"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Enter a prompt to add to the queue..."
            rows={4}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div>
          <label htmlFor="add-prompt-cycles" className="mb-1 block text-sm font-medium text-gray-700">
            Active for (cycles)
          </label>
          <input
            id="add-prompt-cycles"
            type="number"
            min="1"
            value={activeForCycles}
            onChange={(e) => setActiveForCycles(e.target.value)}
            placeholder="Leave empty for permanent"
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <p className="mt-1 text-xs text-gray-500">
            Number of cycles this instruction stays active. Leave empty to keep it permanent.
          </p>
        </div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={handleSubmit} loading={submitting} disabled={!content.trim()}>
          Add
        </Button>
      </div>
    </>
  );
}

// --- StatCard ---

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <p className="text-sm text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-gray-900">{value}</p>
    </div>
  );
}

// --- OutputViewer ---

function OutputViewer({
  entries,
  outputRef,
  autoScrollRef,
}: {
  entries: Array<{ type: string; text: string }>;
  outputRef: React.RefObject<HTMLDivElement | null>;
  autoScrollRef: React.MutableRefObject<boolean>;
}) {
  function handleScroll() {
    const el = outputRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    autoScrollRef.current = atBottom;
  }

  const colorForType = (type: string) => {
    switch (type) {
      case 'tool_start':
      case 'tool_end':
        return 'text-blue-400';
      case 'cycle_start':
      case 'phase_change':
        return 'text-green-400 font-bold';
      case 'cycle_complete':
        return 'text-green-400';
      case 'cycle_failed':
        return 'text-red-400';
      default:
        return 'text-gray-100';
    }
  };

  return (
    <div
      ref={outputRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto whitespace-pre-wrap break-words rounded-lg p-4 font-mono text-sm leading-relaxed text-gray-100"
      style={{ backgroundColor: '#1E1E1E', minHeight: 300 }}
    >
      {entries.length === 0 ? (
        <p className="text-gray-500">
          Waiting for output...
        </p>
      ) : (
        entries.map((entry, i) =>
          entry.type === 'text' ? (
            <MarkdownOutput key={i} text={entry.text} />
          ) : (
            <span key={i} className={colorForType(entry.type)}>
              {entry.text}
            </span>
          )
        )
      )}
    </div>
  );
}

// --- ParallelBatchViewer ---

function ParallelBatchViewer({
  cycles,
  entriesByCycle,
  activeTab,
  onTabChange,
  outputRef,
  autoScrollRef,
}: {
  cycles: ParallelCycleInfo[];
  entriesByCycle: Record<string, Array<{ type: string; text: string }>>;
  activeTab: string | null;
  onTabChange: (id: string) => void;
  outputRef: React.RefObject<HTMLDivElement | null>;
  autoScrollRef: React.MutableRefObject<boolean>;
}) {
  const activeCycleId = activeTab ?? (cycles.length > 0 ? cycles[0].id : null);
  const activeCycle = cycles.find(c => c.id === activeCycleId) ?? null;
  const activeEntries = activeCycleId ? (entriesByCycle[activeCycleId] ?? []) : [];

  function handleScroll() {
    const el = outputRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    autoScrollRef.current = atBottom;
  }

  const statusColor = (s: ParallelCycleInfo['status']) => {
    switch (s) {
      case 'running': return 'bg-blue-400';
      case 'completed': return 'bg-green-400';
      case 'failed': return 'bg-red-400';
    }
  };

  const colorForType = (type: string) => {
    switch (type) {
      case 'tool_start':
      case 'tool_end':
        return 'text-blue-400';
      case 'cycle_start':
      case 'phase_change':
      case 'agent_start':
        return 'text-green-400 font-bold';
      case 'cycle_complete':
      case 'agent_complete':
        return 'text-green-400';
      case 'cycle_failed':
      case 'agent_failed':
        return 'text-red-400';
      case 'review_iteration':
        return 'text-yellow-400';
      default:
        return 'text-gray-100';
    }
  };

  return (
    <div className="mb-4">
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-sm font-medium text-gray-700">
          Parallel Batch — {cycles.length} cycles
        </h2>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-gray-700 mb-2">
        {cycles.map((cycle) => (
          <button
            key={cycle.id}
            onClick={() => onTabChange(cycle.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeCycleId === cycle.id
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-gray-400 hover:text-gray-300'
            }`}
          >
            Cycle {cycle.number}
            {cycle.findingTitle && (
              <span className="ml-1 text-xs opacity-75">
                {cycle.findingTitle.length > 30
                  ? cycle.findingTitle.slice(0, 30) + '...'
                  : cycle.findingTitle}
              </span>
            )}
            {!cycle.findingTitle && cycle.agentName && (
              <span className="ml-1 text-xs opacity-75">{cycle.agentName}</span>
            )}
            <span className={`ml-2 inline-block h-2 w-2 rounded-full ${statusColor(cycle.status)}`} />
          </button>
        ))}
      </div>

      {/* Agent progress for active tab */}
      {activeCycle && activeCycle.agents.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {activeCycle.agents.map((agent) => (
            <span
              key={agent.id}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium ${
                agent.status === 'running' ? 'bg-blue-100 text-blue-800 ring-1 ring-blue-300'
                : agent.status === 'completed' ? 'bg-green-50 text-green-700'
                : agent.status === 'failed' ? 'bg-red-50 text-red-700'
                : 'bg-gray-100 text-gray-600'
              }`}
            >
              <span>{agent.status === 'completed' ? '\u2705' : agent.status === 'running' ? '\u23F3' : agent.status === 'failed' ? '\u274C' : '\u2B1C'}</span>
              <span>{agent.name}</span>
            </span>
          ))}
        </div>
      )}

      {/* Output viewer for active tab */}
      <div
        ref={outputRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto whitespace-pre-wrap break-words rounded-lg p-4 font-mono text-sm leading-relaxed text-gray-100"
        style={{ backgroundColor: '#1E1E1E', minHeight: 300 }}
      >
        {activeEntries.length === 0 ? (
          <p className="text-gray-500">
            Waiting for output...
          </p>
        ) : (
          activeEntries.map((entry, i) =>
            entry.type === 'text' ? (
              <MarkdownOutput key={i} text={entry.text} />
            ) : (
              <span key={i} className={colorForType(entry.type)}>
                {entry.text}
              </span>
            )
          )
        )}
      </div>
    </div>
  );
}
