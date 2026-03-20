'use client';

import { useEffect, useState, useCallback } from 'react';
import { Badge, statusBadgeVariant } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { MarkdownOutput } from '@/components/auto/MarkdownOutput';
import type { Execution } from '@/types';

export default function HistoryPage() {
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Execution | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const fetchHistory = useCallback(() => {
    setError(null);
    fetch('/api/history')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load history');
        return res.json();
      })
      .then((data: Execution[]) => setExecutions(data))
      .catch(() => {
        setError('Failed to load execution history. Please try again.');
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  async function openDetail(id: string) {
    setSelectedId(id);
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/history/${id}`);
      if (!res.ok) throw new Error('Failed to load detail');
      const data: Execution = await res.json();
      setDetail(data);
    } catch {
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }

  function closeDetail() {
    setSelectedId(null);
    setDetail(null);
  }

  function formatDuration(ms: number | null) {
    if (ms == null) return '-';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleString();
  }

  return (
    <div className="p-6">
      <h1 className="mb-6 text-2xl font-bold text-gray-900">
        Execution History
      </h1>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => { setError(null); fetchHistory(); }} className="font-medium text-red-700 hover:text-red-900 underline">
            Retry
          </button>
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        {loading ? (
          <div className="px-6 py-12 text-center text-sm text-gray-500">
            Loading...
          </div>
        ) : executions.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-gray-500">
            No executions yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="px-6 py-3 font-medium text-gray-600">
                  Prompt
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
                <th className="px-6 py-3 font-medium text-gray-600" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {executions.map((exec) => (
                <tr
                  key={exec.id}
                  className="cursor-pointer hover:bg-gray-50"
                  onClick={() => openDetail(exec.id)}
                >
                  <td className="px-6 py-3 font-medium text-gray-900">
                    {exec.prompt_title ?? exec.prompt_id.slice(0, 8)}
                  </td>
                  <td className="px-6 py-3">
                    <Badge variant={statusBadgeVariant(exec.status)}>
                      {exec.status}
                    </Badge>
                  </td>
                  <td className="px-6 py-3 text-gray-600">
                    {exec.cost_usd != null ? `$${exec.cost_usd.toFixed(4)}` : '-'}
                  </td>
                  <td className="px-6 py-3 text-gray-600">
                    {formatDuration(exec.duration_ms)}
                  </td>
                  <td className="px-6 py-3 text-gray-600">
                    {formatDate(exec.started_at)}
                  </td>
                  <td className="px-6 py-3 text-right">
                    <span className="text-blue-500 hover:text-blue-600">
                      View
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>

      {/* Detail Modal */}
      <Modal
        open={selectedId !== null}
        onClose={closeDetail}
        title="Execution Detail"
        size="xl"
        footer={
          <Button variant="secondary" onClick={closeDetail}>
            Close
          </Button>
        }
      >
        {detailLoading ? (
          <p className="text-sm text-gray-500">Loading...</p>
        ) : detail ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-gray-500">Prompt:</span>{' '}
                <span className="font-medium text-gray-900">
                  {detail.prompt_title ?? detail.prompt_id.slice(0, 8)}
                </span>
              </div>
              <div>
                <span className="text-gray-500">Status:</span>{' '}
                <Badge variant={statusBadgeVariant(detail.status)}>
                  {detail.status}
                </Badge>
              </div>
              <div>
                <span className="text-gray-500">Cost:</span>{' '}
                <span className="text-gray-900">
                  {detail.cost_usd != null
                    ? `$${detail.cost_usd.toFixed(4)}`
                    : '-'}
                </span>
              </div>
              <div>
                <span className="text-gray-500">Duration:</span>{' '}
                <span className="text-gray-900">
                  {formatDuration(detail.duration_ms)}
                </span>
              </div>
            </div>
            <div>
              <p className="mb-1 text-sm font-medium text-gray-700">Output</p>
              <div
                className="max-h-80 overflow-y-auto rounded p-3 text-xs leading-relaxed text-gray-100"
                style={{ backgroundColor: '#1E1E1E' }}
              >
                {detail.output ? <MarkdownOutput text={detail.output} /> : '(no output)'}
              </div>
            </div>
          </div>
        ) : (
          <p className="text-sm text-gray-500">Failed to load detail.</p>
        )}
      </Modal>
    </div>
  );
}
