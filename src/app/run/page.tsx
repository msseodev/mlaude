'use client';

import { Suspense, useState, useCallback, useRef, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useSSE } from '@/hooks/useSSE';
import { useRunStatus } from '@/hooks/useRunStatus';
import { Button } from '@/components/ui/Button';
import { Badge, statusBadgeVariant } from '@/components/ui/Badge';
import { useToast } from '@/components/ui/Toast';
import { MarkdownOutput } from '@/components/auto/MarkdownOutput';
import type { SSEEvent, SessionStatus, Plan, PlanWithItems } from '@/types';

const MAX_OUTPUT_ENTRIES = 10000;

interface PromptOption {
  id: string;
  title: string;
}

interface PlanItemOption {
  id: string;
  prompt_title?: string;
  item_order: number;
}

export default function RunPage() {
  return (
    <Suspense fallback={<div className="p-6"><p className="text-sm text-gray-500">Loading...</p></div>}>
      <RunPageContent />
    </Suspense>
  );
}

function RunPageContent() {
  const searchParams = useSearchParams();
  const { status, refresh } = useRunStatus();
  const { showToast } = useToast();
  const [output, setOutput] = useState<Array<{ type: string; text: string }>>([]);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prompts, setPrompts] = useState<PromptOption[]>([]);
  const [startFromPromptId, setStartFromPromptId] = useState<string>('');
  const [plans, setPlans] = useState<Plan[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string>('');
  const [planItems, setPlanItems] = useState<PlanItemOption[]>([]);
  const [startFromPlanItemId, setStartFromPlanItemId] = useState<string>('');

  const sessionStatus: SessionStatus = status?.status ?? 'idle';

  // Read planId from URL search params
  useEffect(() => {
    const urlPlanId = searchParams.get('planId');
    if (urlPlanId) {
      setSelectedPlanId(urlPlanId);
    }
  }, [searchParams]);

  // Fetch prompts and plans
  const fetchData = useCallback(() => {
    setError(null);
    Promise.all([
      fetch('/api/prompts').then(r => {
        if (!r.ok) throw new Error('Failed to load prompts');
        return r.json();
      }),
      fetch('/api/plans').then(r => {
        if (!r.ok) throw new Error('Failed to load plans');
        return r.json();
      }),
    ])
      .then(([promptsData, plansData]: [PromptOption[], Plan[]]) => {
        setPrompts(promptsData);
        setPlans(plansData);
      })
      .catch(() => {
        setError('Failed to load prompts or plans. Please try again.');
      });
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Fetch plan items when plan is selected
  useEffect(() => {
    if (!selectedPlanId) {
      setPlanItems([]);
      setStartFromPlanItemId('');
      return;
    }
    fetch(`/api/plans/${selectedPlanId}`)
      .then(r => {
        if (!r.ok) throw new Error('Failed to load plan details');
        return r.json();
      })
      .then((data: PlanWithItems) => {
        setPlanItems(
          data.items.map(i => ({
            id: i.id,
            prompt_title: i.prompt_title,
            item_order: i.item_order,
          }))
        );
      })
      .catch(() => {
        showToast('Failed to load plan details', 'error');
      });
  }, [selectedPlanId, showToast]);

  const handleSSEEvent = useCallback(
    (event: SSEEvent) => {
      switch (event.type) {
        case 'text_delta': {
          const text = (event.data.text as string) ?? '';
          setOutput((prev) => {
            // Coalesce consecutive text entries
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
          break;
        }
        case 'tool_start':
        case 'tool_end':
          // Handled visually via tool_input and tool_result instead
          break;
        case 'tool_input': {
          const tool = (event.data.tool as string) ?? 'unknown';
          const input = (event.data.input as Record<string, unknown>) ?? {};
          const summary = formatToolSummary(tool, input);
          setOutput((prev) => {
            const next = [...prev, { type: 'tool_call', text: `\u2588 ${tool}(${summary})` }];
            return next.length > MAX_OUTPUT_ENTRIES ? next.slice(-MAX_OUTPUT_ENTRIES) : next;
          });
          break;
        }
        case 'tool_result': {
          const content = (event.data.content as string) ?? (event.data.stdout as string) ?? '';
          const isError = (event.data.is_error as boolean) ?? false;
          const stderr = (event.data.stderr as string) ?? '';
          const display = isError && stderr ? stderr : content;
          const truncated = display.length > 1000 ? display.slice(0, 1000) + '...' : display;
          if (truncated) {
            setOutput((prev) => {
              const next = [...prev, { type: 'tool_result', text: `  \u23BF  ${truncated}` }];
              return next.length > MAX_OUTPUT_ENTRIES ? next.slice(-MAX_OUTPUT_ENTRIES) : next;
            });
          }
          break;
        }
        case 'prompt_start': {
          const title = (event.data.promptTitle as string) ?? '';
          setOutput((prev) => [
            ...prev,
            { type: 'prompt_start', text: `\n========== Prompt: ${title} ==========\n` },
          ]);
          refresh();
          break;
        }
        case 'prompt_complete':
        case 'prompt_failed': {
          const title = (event.data.promptTitle as string) ?? '';
          const label = event.type === 'prompt_complete' ? 'COMPLETED' : 'FAILED';
          setOutput((prev) => [
            ...prev,
            { type: event.type, text: `\n========== ${label}: ${title} ==========\n` },
          ]);
          refresh();
          break;
        }
        case 'rate_limit':
        case 'rate_limit_wait':
        case 'queue_complete':
        case 'queue_stopped':
        case 'session_status':
        case 'error':
          refresh();
          break;
      }
    },
    [refresh]
  );

  const handleReconnect = useCallback(() => {
    setOutput([]); // Clear on reconnection to prevent duplicates
  }, []);

  const { connected } = useSSE('/api/run/stream', handleSSEEvent, handleReconnect);

  async function handleStart() {
    setActionLoading(true);
    setOutput([]);
    try {
      const body: Record<string, string> = {};
      if (selectedPlanId) {
        body.planId = selectedPlanId;
        if (startFromPlanItemId) {
          body.startFromPlanItemId = startFromPlanItemId;
        }
      } else if (startFromPromptId) {
        body.startFromPromptId = startFromPromptId;
      }
      const res = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast(data.error || 'Failed to start queue', 'error');
      }
      await refresh();
    } catch {
      showToast('Failed to start queue', 'error');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleStop() {
    setActionLoading(true);
    try {
      const res = await fetch('/api/run', { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast(data.error || 'Failed to stop queue', 'error');
      }
      await refresh();
    } catch {
      showToast('Failed to stop queue', 'error');
    } finally {
      setActionLoading(false);
    }
  }

  async function handlePause() {
    setActionLoading(true);
    try {
      const res = await fetch('/api/run', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'pause' }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast(data.error || 'Failed to pause queue', 'error');
      }
      await refresh();
    } catch {
      showToast('Failed to pause queue', 'error');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleResume() {
    setActionLoading(true);
    try {
      const res = await fetch('/api/run', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'resume' }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast(data.error || 'Failed to resume queue', 'error');
      }
      await refresh();
    } catch {
      showToast('Failed to resume queue', 'error');
    } finally {
      setActionLoading(false);
    }
  }

  return (
    <div className="flex h-full flex-col p-6">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-900">Run Queue</h1>
          <Badge variant={statusBadgeVariant(sessionStatus)}>
            {sessionStatus}
          </Badge>
          {connected && (
            <span className="inline-flex items-center gap-1 text-xs text-green-600">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-500" />
              Live
            </span>
          )}
        </div>
        <RunControls
          status={sessionStatus}
          loading={actionLoading}
          onStart={handleStart}
          onStop={handleStop}
          onPause={handlePause}
          onResume={handleResume}
          prompts={prompts}
          startFromPromptId={startFromPromptId}
          onStartFromChange={setStartFromPromptId}
          plans={plans}
          selectedPlanId={selectedPlanId}
          onPlanChange={setSelectedPlanId}
          planItems={planItems}
          startFromPlanItemId={startFromPlanItemId}
          onStartFromPlanItemChange={setStartFromPlanItemId}
        />
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => { setError(null); fetchData(); }} className="font-medium text-red-700 hover:text-red-900 underline">
            Retry
          </button>
        </div>
      )}

      {/* Progress */}
      {status && sessionStatus !== 'idle' && (
        <PromptProgress
          completed={status.completedCount}
          total={status.totalCount}
          currentTitle={status.currentPromptTitle}
          planName={status.planName}
        />
      )}

      {/* Rate Limit Banner */}
      {sessionStatus === 'waiting_for_limit' && status?.waitingUntil && (
        <RateLimitBanner
          waitingUntil={status.waitingUntil}
          retryCount={status.retryCount}
        />
      )}

      {/* Output Viewer */}
      <OutputViewer entries={output} />
    </div>
  );
}

// --- RunControls ---

function RunControls({
  status,
  loading,
  onStart,
  onStop,
  onPause,
  onResume,
  prompts,
  startFromPromptId,
  onStartFromChange,
  plans,
  selectedPlanId,
  onPlanChange,
  planItems,
  startFromPlanItemId,
  onStartFromPlanItemChange,
}: {
  status: SessionStatus;
  loading: boolean;
  onStart: () => void;
  onStop: () => void;
  onPause: () => void;
  onResume: () => void;
  prompts: PromptOption[];
  startFromPromptId: string;
  onStartFromChange: (id: string) => void;
  plans: Plan[];
  selectedPlanId: string;
  onPlanChange: (id: string) => void;
  planItems: PlanItemOption[];
  startFromPlanItemId: string;
  onStartFromPlanItemChange: (id: string) => void;
}) {
  const canStart = status === 'idle' || status === 'completed' || status === 'stopped';

  return (
    <div className="flex items-center gap-2">
      {canStart && (
        <>
          <select
            value={selectedPlanId}
            onChange={(e) => onPlanChange(e.target.value)}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="">No plan (all prompts)</option>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          {selectedPlanId ? (
            <select
              value={startFromPlanItemId}
              onChange={(e) => onStartFromPlanItemChange(e.target.value)}
              className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">From beginning</option>
              {planItems.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.prompt_title ?? `Item ${item.item_order + 1}`}
                </option>
              ))}
            </select>
          ) : (
            <select
              value={startFromPromptId}
              onChange={(e) => onStartFromChange(e.target.value)}
              className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">All prompts</option>
              {prompts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          )}
          <Button onClick={onStart} loading={loading} variant="success">
            Start
          </Button>
        </>
      )}
      {status === 'running' && (
        <>
          <Button onClick={onPause} loading={loading} variant="secondary">
            Pause
          </Button>
          <Button onClick={onStop} loading={loading} variant="danger">
            Stop
          </Button>
        </>
      )}
      {status === 'paused' && (
        <>
          <Button onClick={onResume} loading={loading} variant="success">
            Resume
          </Button>
          <Button onClick={onStop} loading={loading} variant="danger">
            Stop
          </Button>
        </>
      )}
      {status === 'waiting_for_limit' && (
        <Button onClick={onStop} loading={loading} variant="danger">
          Stop
        </Button>
      )}
    </div>
  );
}

// --- PromptProgress ---

function PromptProgress({
  completed,
  total,
  currentTitle,
  planName,
}: {
  completed: number;
  total: number;
  currentTitle: string | null;
  planName?: string | null;
}) {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <div className="mb-4 rounded-lg border border-gray-200 bg-white p-4">
      {planName && (
        <p className="mb-2 text-xs font-medium text-blue-600">
          Plan: {planName}
        </p>
      )}
      <div className="mb-2 flex items-center justify-between text-sm">
        <span className="text-gray-700">
          Completed {completed} of {total} prompts
        </span>
        <span className="font-medium text-gray-900">{pct}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-gray-200">
        <div
          className="h-full rounded-full bg-blue-500 transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
      {currentTitle && (
        <p className="mt-2 text-xs text-gray-500">
          Running: {currentTitle}
        </p>
      )}
    </div>
  );
}

// --- RateLimitBanner ---

function RateLimitBanner({
  waitingUntil,
  retryCount,
}: {
  waitingUntil: string;
  retryCount: number;
}) {
  const [remaining, setRemaining] = useState('');

  useEffect(() => {
    function update() {
      const diff = new Date(waitingUntil).getTime() - Date.now();
      if (diff <= 0) {
        setRemaining('resuming...');
        return;
      }
      const secs = Math.ceil(diff / 1000);
      const mins = Math.floor(secs / 60);
      const s = secs % 60;
      setRemaining(mins > 0 ? `${mins}m ${s}s` : `${s}s`);
    }
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [waitingUntil]);

  return (
    <div className="mb-4 rounded-lg border border-yellow-300 bg-yellow-50 px-4 py-3">
      <div className="flex items-center gap-2">
        <svg
          className="h-5 w-5 text-yellow-600"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        <span className="text-sm font-medium text-yellow-800">
          Rate limit reached. Retrying in {remaining}
          {retryCount > 0 && ` (attempt ${retryCount})`}
        </span>
      </div>
    </div>
  );
}

// --- Tool Display Helpers ---

function formatToolSummary(tool: string, input: Record<string, unknown>): string {
  let summary = '';
  switch (tool) {
    case 'Bash': summary = (input.command as string) ?? ''; break;
    case 'Read': summary = (input.file_path as string) ?? ''; break;
    case 'Write': summary = (input.file_path as string) ?? ''; break;
    case 'Edit': summary = (input.file_path as string) ?? ''; break;
    case 'Grep': {
      const pattern = (input.pattern as string) ?? '';
      const path = (input.path as string) ?? '';
      summary = path ? `${pattern}, ${path}` : pattern;
      break;
    }
    case 'Glob': summary = (input.pattern as string) ?? ''; break;
    case 'Agent': summary = (input.description as string) ?? ''; break;
    case 'WebSearch': summary = (input.query as string) ?? ''; break;
    case 'WebFetch': summary = (input.url as string) ?? ''; break;
    default: {
      const json = JSON.stringify(input);
      summary = json.length > 120 ? json.slice(0, 120) + '...' : json;
    }
  }
  // Truncate long summaries
  if (summary.length > 200) {
    summary = summary.slice(0, 200) + '...';
  }
  return summary;
}

// --- OutputViewer ---

function OutputViewer({
  entries,
}: {
  entries: Array<{ type: string; text: string }>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);

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

  const renderEntry = (entry: { type: string; text: string }, i: number) => {
    switch (entry.type) {
      case 'text':
        return <MarkdownOutput key={i} text={entry.text} />;
      case 'tool_call':
        return (
          <div key={i} className="my-1">
            <span className="text-cyan-400 font-semibold">{entry.text}</span>
          </div>
        );
      case 'tool_result':
        return (
          <div key={i} className="mb-2 ml-2 text-gray-400 border-l-2 border-gray-600 pl-2 text-xs leading-relaxed" style={{ maxHeight: 300, overflow: 'auto' }}>
            <pre className="whitespace-pre-wrap">{entry.text}</pre>
          </div>
        );
      case 'prompt_start':
        return <span key={i} className="text-green-400 font-bold">{entry.text}</span>;
      case 'prompt_complete':
        return <span key={i} className="text-green-400">{entry.text}</span>;
      case 'prompt_failed':
        return <span key={i} className="text-red-400">{entry.text}</span>;
      default:
        return <span key={i} className="text-gray-100">{entry.text}</span>;
    }
  };

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto whitespace-pre-wrap break-words rounded-lg p-4 font-mono text-sm leading-relaxed"
      style={{ backgroundColor: '#1E1E1E', minHeight: 300 }}
    >
      {entries.length === 0 ? (
        <p className="text-gray-500">
          Output will appear here when the queue is running...
        </p>
      ) : (
        entries.map((entry, i) => renderEntry(entry, i))
      )}
    </div>
  );
}
