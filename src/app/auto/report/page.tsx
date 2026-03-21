'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { useToast } from '@/components/ui/Toast';
import type { BadgeVariant } from '@/components/ui/Badge';

// --- Label maps ---

const statusLabel: Record<string, string> = {
  resolved: 'Resolved',
  open: 'Open',
  in_progress: 'In Progress',
  wont_fix: "Won't Fix",
  duplicate: 'Duplicate',
};

const categoryLabel: Record<string, string> = {
  bug: 'Bug',
  improvement: 'Improvement',
  idea: 'Idea',
  test_failure: 'Test Failure',
  performance: 'Performance',
  accessibility: 'Accessibility',
  security: 'Security',
};

const priorityLabel: Record<string, string> = {
  P0: 'Critical',
  P1: 'High',
  P2: 'Medium',
  P3: 'Low',
};

const phaseLabel: Record<string, string> = {
  discovery: 'Discovery',
  fix: 'Fix',
  test: 'Test',
  improve: 'Improve',
  review: 'Review',
  pipeline: 'Pipeline',
};

const cycleStatusLabel: Record<string, string> = {
  completed: 'Completed',
  failed: 'Failed',
  running: 'Running',
  rate_limited: 'Rate Limited',
  rolled_back: 'Rolled Back',
};

const sessionStatusLabel: Record<string, string> = {
  running: 'Running',
  paused: 'Paused',
  waiting_for_limit: 'Waiting (Rate Limit)',
  completed: 'Completed',
  stopped: 'Stopped',
};

const requestTypeLabel: Record<string, string> = {
  permission: 'Permission',
  resource: 'Resource',
  decision: 'Decision',
  information: 'Information',
};

const requestStatusLabel: Record<string, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  answered: 'Answered',
};

// --- Badge variant helpers ---

function findingStatusBadgeVariant(status: string): BadgeVariant {
  switch (status) {
    case 'resolved': return 'green';
    case 'open': return 'red';
    case 'in_progress': return 'blue';
    case 'wont_fix': return 'gray';
    case 'duplicate': return 'gray';
    default: return 'gray';
  }
}

function priorityBadgeVariant(priority: string): BadgeVariant {
  switch (priority) {
    case 'P0': return 'red';
    case 'P1': return 'yellow';
    case 'P2': return 'blue';
    case 'P3': return 'green';
    default: return 'gray';
  }
}

function cycleStatusBadgeVariant(status: string): BadgeVariant {
  switch (status) {
    case 'completed': return 'green';
    case 'failed': return 'red';
    case 'running': return 'blue';
    case 'rate_limited': return 'yellow';
    case 'rolled_back': return 'yellow';
    default: return 'gray';
  }
}

function ceoRequestTypeBadgeVariant(type: string): BadgeVariant {
  switch (type) {
    case 'permission': return 'red';
    case 'resource': return 'yellow';
    case 'decision': return 'blue';
    case 'information': return 'green';
    default: return 'gray';
  }
}

function ceoRequestStatusBadgeVariant(status: string): BadgeVariant {
  switch (status) {
    case 'pending': return 'yellow';
    case 'approved': return 'green';
    case 'rejected': return 'red';
    case 'answered': return 'blue';
    default: return 'gray';
  }
}

// --- Types ---

interface CEORequestItem {
  id: string;
  session_id: string;
  cycle_id: string | null;
  from_agent: string;
  type: string;
  title: string;
  description: string;
  blocking: number;
  status: string;
  ceo_response: string | null;
  created_at: string;
  responded_at: string | null;
}

interface ReportData {
  session: {
    id: string;
    status: string;
    targetProject: string;
    totalCycles: number;
    totalCost: number;
    startedAt: string;
  };
  summary: {
    completedCycles: number;
    failedCycles: number;
    avgScore: number | null;
    successRate: number | null;
  };
  findings: {
    total: number;
    resolved: number;
    open: number;
    inProgress: number;
    wontFix: number;
    byPriority: {
      P0: number;
      P1: number;
      P2: number;
      P3: number;
    };
    items: Array<{
      id: string;
      title: string;
      category: string;
      priority: string;
      status: string;
      retryCount: number;
    }>;
  };
  recentCycles: Array<{
    number: number;
    phase: string;
    status: string;
    score: number | null;
    cost: number | null;
    duration: number | null;
    completedAt: string | null;
  }>;
  ceoRequests?: {
    pending: CEORequestItem[];
    responded: CEORequestItem[];
  };
}

// --- Helper functions ---

function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function formatTime(iso: string | null): string {
  if (!iso) return '\u2014';
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

function formatDuration(ms: number | null): string {
  if (ms == null) return '\u2014';
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${minutes}m ${secs}s`;
}

// --- Main page component ---

export default function AutoReportPage() {
  const { showToast } = useToast();
  const [report, setReport] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Instruction form state
  const [instruction, setInstruction] = useState('');
  const [isPermanent, setIsPermanent] = useState(true);
  const [cycleCount, setCycleCount] = useState(5);
  const [submitting, setSubmitting] = useState(false);

  // CEO request response state
  const [ceoResponses, setCeoResponses] = useState<Record<string, string>>({});
  const [ceoSubmitting, setCeoSubmitting] = useState<Record<string, boolean>>({});
  const [showRespondedRequests, setShowRespondedRequests] = useState(false);

  const fetchReport = useCallback(async () => {
    try {
      const res = await fetch('/api/auto/report');
      if (res.status === 404) {
        setReport(null);
        setError(null);
        setLoading(false);
        return;
      }
      if (!res.ok) {
        throw new Error('Failed to fetch report');
      }
      const data: ReportData = await res.json();
      setReport(data);
      setError(null);
      setLastRefreshed(new Date());
    } catch {
      setError('Failed to load report.');
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  // Auto-refresh every 30 seconds when session is running
  useEffect(() => {
    if (report?.session.status === 'running') {
      intervalRef.current = setInterval(fetchReport, 30000);
    } else if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [report?.session.status, fetchReport]);

  async function handleSubmitInstruction() {
    if (!instruction.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/auto/report/instruct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: instruction.trim(),
          activeForCycles: isPermanent ? null : cycleCount,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast(data.error || 'Failed to send instruction.', 'error');
        return;
      }
      showToast('Instruction sent.', 'success');
      setInstruction('');
    } catch {
      showToast('Failed to send instruction.', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCEORespond(requestId: string, status: string) {
    const responseText = ceoResponses[requestId]?.trim();
    if (!responseText) {
      showToast('Enter your response.', 'error');
      return;
    }
    setCeoSubmitting(prev => ({ ...prev, [requestId]: true }));
    try {
      const res = await fetch(`/api/auto/report/requests/${requestId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, response: responseText }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast(data.error || 'Failed to send response.', 'error');
        return;
      }
      showToast('Response sent.', 'success');
      setCeoResponses(prev => {
        const updated = { ...prev };
        delete updated[requestId];
        return updated;
      });
      fetchReport();
    } catch {
      showToast('Failed to send response.', 'error');
    } finally {
      setCeoSubmitting(prev => ({ ...prev, [requestId]: false }));
    }
  }

  if (loading) {
    return (
      <div className="p-6">
        <h1 className="mb-6 text-2xl font-bold text-gray-900">Autonomous Report</h1>
        <p className="text-sm text-gray-500">Loading...</p>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="p-6">
        <h1 className="mb-6 text-2xl font-bold text-gray-900">Autonomous Report</h1>
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
          <p className="text-gray-500">No active session.</p>
          <p className="mt-2 text-sm text-gray-400">
            The report will appear here once autonomous mode is started.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Autonomous Report</h1>
          <p className="mt-1 text-sm text-gray-500">
            Session: {report.session.id.slice(0, 8)}...
            {' | '}
            Status: {sessionStatusLabel[report.session.status] ?? report.session.status}
            {' | '}
            Started: {formatDateTime(report.session.startedAt)}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {lastRefreshed && (
            <span className="text-xs text-gray-400">
              Last updated: {lastRefreshed.toLocaleTimeString('en-US')}
            </span>
          )}
          {report.session.status === 'running' && (
            <span className="inline-flex items-center gap-1 text-xs text-green-600">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
              Auto refresh
            </span>
          )}
          <Button variant="secondary" size="sm" onClick={fetchReport}>
            Refresh
          </Button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={fetchReport} className="font-medium text-red-700 hover:text-red-900 underline">
            Retry
          </button>
        </div>
      )}

      {/* Summary Cards */}
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <SummaryCard label="Total Cycles" value={report.session.totalCycles} />
        <SummaryCard
          label="Success Rate"
          value={report.summary.successRate != null ? `${report.summary.successRate}%` : '\u2014'}
        />
        <SummaryCard
          label="Avg Score"
          value={report.summary.avgScore != null ? `${report.summary.avgScore}/100` : '\u2014'}
        />
        <SummaryCard label="Total Cost" value={`$${report.session.totalCost.toFixed(2)}`} />
      </div>

      {/* Findings Section */}
      <div className="mb-6 rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold text-gray-900">Findings Overview</h2>

        {/* Status Summary */}
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-md bg-green-50 p-3 text-center">
            <p className="text-2xl font-bold text-green-700">{report.findings.resolved}</p>
            <p className="text-xs text-green-600">Resolved</p>
          </div>
          <div className="rounded-md bg-blue-50 p-3 text-center">
            <p className="text-2xl font-bold text-blue-700">{report.findings.inProgress}</p>
            <p className="text-xs text-blue-600">In Progress</p>
          </div>
          <div className="rounded-md bg-red-50 p-3 text-center">
            <p className="text-2xl font-bold text-red-700">{report.findings.open}</p>
            <p className="text-xs text-red-600">Open</p>
          </div>
          <div className="rounded-md bg-gray-50 p-3 text-center">
            <p className="text-2xl font-bold text-gray-700">{report.findings.wontFix}</p>
            <p className="text-xs text-gray-600">Won&apos;t Fix</p>
          </div>
        </div>

        {/* Priority Breakdown */}
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium text-gray-700">Priority:</span>
          <Badge variant="red">P0 Critical: {report.findings.byPriority.P0}</Badge>
          <Badge variant="yellow">P1 High: {report.findings.byPriority.P1}</Badge>
          <Badge variant="blue">P2 Medium: {report.findings.byPriority.P2}</Badge>
          <Badge variant="green">P3 Low: {report.findings.byPriority.P3}</Badge>
        </div>

        {/* Findings Table */}
        {report.findings.items.length > 0 ? (
          <div className="overflow-hidden rounded-lg border border-gray-200">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Status</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Priority</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Category</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Title</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Retries</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {report.findings.items.map((f) => (
                  <tr key={f.id}>
                    <td className="px-4 py-2">
                      <Badge variant={findingStatusBadgeVariant(f.status)}>
                        {statusLabel[f.status] ?? f.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-2">
                      <Badge variant={priorityBadgeVariant(f.priority)}>
                        {f.priority} {priorityLabel[f.priority] ?? ''}
                      </Badge>
                    </td>
                    <td className="px-4 py-2 text-sm text-gray-600">
                      {categoryLabel[f.category] ?? f.category}
                    </td>
                    <td className="px-4 py-2 text-sm text-gray-900">{f.title}</td>
                    <td className="px-4 py-2 text-sm text-gray-600">{f.retryCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-gray-400">No findings.</p>
        )}
      </div>

      {/* Recent Cycles */}
      <div className="mb-6 rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold text-gray-900">Recent Cycles</h2>

        {report.recentCycles.length > 0 ? (
          <div className="overflow-hidden rounded-lg border border-gray-200">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">#</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Phase</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Status</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Score</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Cost</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Duration</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Completed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {report.recentCycles.map((c, idx) => (
                  <tr key={`${c.number}-${idx}`}>
                    <td className="px-4 py-2 text-sm font-medium text-gray-900">{c.number}</td>
                    <td className="px-4 py-2 text-sm text-gray-600">
                      {phaseLabel[c.phase] ?? c.phase}
                    </td>
                    <td className="px-4 py-2">
                      <Badge variant={cycleStatusBadgeVariant(c.status)}>
                        {cycleStatusLabel[c.status] ?? c.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-2 text-sm text-gray-600">
                      {c.score != null ? c.score : '\u2014'}
                    </td>
                    <td className="px-4 py-2 text-sm text-gray-600">
                      {c.cost != null ? `$${c.cost.toFixed(2)}` : '\u2014'}
                    </td>
                    <td className="px-4 py-2 text-sm text-gray-600">
                      {formatDuration(c.duration)}
                    </td>
                    <td className="px-4 py-2 text-sm text-gray-600">
                      {formatTime(c.completedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-gray-400">No cycles yet.</p>
        )}
      </div>

      {/* CEO Requests Section */}
      {report.ceoRequests && (report.ceoRequests.pending.length > 0 || report.ceoRequests.responded.length > 0) && (
        <div className="mb-6 rounded-lg border border-orange-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold text-gray-900">
            CEO Requests
            {report.ceoRequests.pending.length > 0 && (
              <Badge variant="red" className="ml-2">
                {report.ceoRequests.pending.length} pending
              </Badge>
            )}
          </h2>

          {/* Pending requests */}
          {report.ceoRequests.pending.length > 0 && (
            <div className="space-y-4">
              {report.ceoRequests.pending.map((req) => (
                <div
                  key={req.id}
                  className={`rounded-lg border p-4 ${req.blocking ? 'border-red-300 bg-red-50' : 'border-yellow-300 bg-yellow-50'}`}
                >
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <Badge variant={ceoRequestTypeBadgeVariant(req.type)}>
                      {requestTypeLabel[req.type] ?? req.type}
                    </Badge>
                    {req.blocking === 1 && (
                      <Badge variant="red">Blocking</Badge>
                    )}
                    <span className="text-sm font-semibold text-gray-900">{req.title}</span>
                  </div>
                  <div className="mb-1 text-xs text-gray-500">
                    From: {req.from_agent} | {formatDateTime(req.created_at)}
                  </div>
                  {req.description && (
                    <p className="mb-3 text-sm text-gray-700">{req.description}</p>
                  )}
                  {req.blocking === 1 && (
                    <p className="mb-3 text-xs font-medium text-red-600">
                      Related work is on hold until CEO responds.
                    </p>
                  )}
                  <div className="space-y-2">
                    <textarea
                      value={ceoResponses[req.id] ?? ''}
                      onChange={(e) => setCeoResponses(prev => ({ ...prev, [req.id]: e.target.value }))}
                      placeholder="Enter your response..."
                      rows={2}
                      className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                    <div className="flex gap-2">
                      {(req.type === 'permission' || req.type === 'resource') && (
                        <>
                          <Button
                            size="sm"
                            onClick={() => handleCEORespond(req.id, 'approved')}
                            loading={ceoSubmitting[req.id]}
                            disabled={!ceoResponses[req.id]?.trim()}
                          >
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => handleCEORespond(req.id, 'rejected')}
                            loading={ceoSubmitting[req.id]}
                            disabled={!ceoResponses[req.id]?.trim()}
                          >
                            Reject
                          </Button>
                        </>
                      )}
                      <Button
                        size="sm"
                        variant={req.type === 'permission' || req.type === 'resource' ? 'secondary' : undefined}
                        onClick={() => handleCEORespond(req.id, 'answered')}
                        loading={ceoSubmitting[req.id]}
                        disabled={!ceoResponses[req.id]?.trim()}
                      >
                        Answer
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Responded requests (collapsible) */}
          {report.ceoRequests.responded.length > 0 && (
            <div className={report.ceoRequests.pending.length > 0 ? 'mt-4' : ''}>
              <button
                onClick={() => setShowRespondedRequests(!showRespondedRequests)}
                className="flex items-center gap-1 text-sm font-medium text-gray-600 hover:text-gray-900"
              >
                <span className="text-xs">{showRespondedRequests ? '\u25BC' : '\u25B6'}</span>
                Responded Requests ({report.ceoRequests.responded.length})
              </button>
              {showRespondedRequests && (
                <div className="mt-3 space-y-2">
                  {report.ceoRequests.responded.map((req) => (
                    <div
                      key={req.id}
                      className="rounded-lg border border-gray-200 bg-gray-50 p-3"
                    >
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <Badge variant={ceoRequestStatusBadgeVariant(req.status)}>
                          {requestStatusLabel[req.status] ?? req.status}
                        </Badge>
                        <Badge variant={ceoRequestTypeBadgeVariant(req.type)}>
                          {requestTypeLabel[req.type] ?? req.type}
                        </Badge>
                        <span className="text-sm font-medium text-gray-700">{req.title}</span>
                      </div>
                      <div className="text-xs text-gray-500">
                        From: {req.from_agent} | Responded: {req.responded_at ? formatDateTime(req.responded_at) : '\u2014'}
                      </div>
                      {req.ceo_response && (
                        <p className="mt-1 text-sm text-gray-600">
                          <span className="font-medium">CEO Response:</span> {req.ceo_response}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Instruction Input */}
      <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold text-gray-900">New Instruction</h2>
        <div className="space-y-4">
          <div>
            <label htmlFor="report-instruction" className="mb-1 block text-sm font-medium text-gray-700">
              Instruction
            </label>
            <textarea
              id="report-instruction"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder="Enter a new direction or instruction..."
              rows={4}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <input
                id="report-permanent"
                type="checkbox"
                checked={isPermanent}
                onChange={(e) => setIsPermanent(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-blue-500 focus:ring-blue-500"
              />
              <label htmlFor="report-permanent" className="text-sm text-gray-700">
                Permanent
              </label>
            </div>

            {!isPermanent && (
              <div className="flex items-center gap-2">
                <label htmlFor="report-cycle-count" className="text-sm text-gray-700">
                  Cycle count:
                </label>
                <input
                  id="report-cycle-count"
                  type="number"
                  min={1}
                  value={cycleCount}
                  onChange={(e) => setCycleCount(parseInt(e.target.value, 10) || 1)}
                  className="w-20 rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
            )}
          </div>

          <div className="flex justify-end">
            <Button
              onClick={handleSubmitInstruction}
              loading={submitting}
              disabled={!instruction.trim()}
            >
              Submit
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- SummaryCard ---

function SummaryCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <p className="text-sm text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-gray-900">{value}</p>
    </div>
  );
}
