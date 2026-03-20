'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { MarkdownOutput } from '@/components/auto/MarkdownOutput';
import type { AutoFinding, FindingStatus, FindingPriority } from '@/types';

type BadgeVariant = 'gray' | 'blue' | 'green' | 'yellow' | 'red' | 'purple';

function priorityBadgeVariant(priority: FindingPriority): BadgeVariant {
  switch (priority) {
    case 'P0': return 'red';
    case 'P1': return 'yellow';
    case 'P2': return 'blue';
    case 'P3': return 'gray';
    default: return 'gray';
  }
}

function statusBadgeVariant(status: FindingStatus): BadgeVariant {
  switch (status) {
    case 'open': return 'blue';
    case 'in_progress': return 'yellow';
    case 'resolved': return 'green';
    case 'wont_fix': return 'gray';
    case 'duplicate': return 'purple';
    default: return 'gray';
  }
}

const STATUS_OPTIONS: { label: string; value: string }[] = [
  { label: 'All', value: '' },
  { label: 'Open', value: 'open' },
  { label: 'In Progress', value: 'in_progress' },
  { label: 'Resolved', value: 'resolved' },
  { label: "Won't Fix", value: 'wont_fix' },
  { label: 'Duplicate', value: 'duplicate' },
];

const PRIORITY_OPTIONS: { label: string; value: string }[] = [
  { label: 'All', value: '' },
  { label: 'P0', value: 'P0' },
  { label: 'P1', value: 'P1' },
  { label: 'P2', value: 'P2' },
  { label: 'P3', value: 'P3' },
];

const CATEGORY_OPTIONS: { label: string; value: string }[] = [
  { label: 'All', value: '' },
  { label: 'Bug', value: 'bug' },
  { label: 'Improvement', value: 'improvement' },
  { label: 'Idea', value: 'idea' },
  { label: 'Test Failure', value: 'test_failure' },
  { label: 'Performance', value: 'performance' },
  { label: 'Accessibility', value: 'accessibility' },
  { label: 'Security', value: 'security' },
];

const INLINE_STATUS_OPTIONS: FindingStatus[] = [
  'open',
  'in_progress',
  'resolved',
  'wont_fix',
  'duplicate',
];

const SORT_OPTIONS: { label: string; value: string }[] = [
  { label: 'Priority', value: 'priority' },
  { label: 'Status', value: 'status' },
  { label: 'Category', value: 'category' },
  { label: 'Title', value: 'title' },
  { label: 'Retries', value: 'retries' },
  { label: 'Created', value: 'created' },
];

const STORAGE_KEY = 'mclaude_findings_prefs';

function loadPrefs(): { status: string; priority: string; category: string; sortBy: string; sortDir: 'asc' | 'desc' } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { status: '', priority: '', category: '', sortBy: 'priority', sortDir: 'asc' };
}

function savePrefs(prefs: { status: string; priority: string; category: string; sortBy: string; sortDir: string }) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs)); } catch { /* ignore */ }
}

function formatStatusLabel(status: string): string {
  return status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

const PRIORITY_ORDER: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
const STATUS_ORDER: Record<string, number> = { open: 0, in_progress: 1, resolved: 2, wont_fix: 3, duplicate: 4 };

function sortFindings(items: AutoFinding[], sortBy: string, sortDir: 'asc' | 'desc'): AutoFinding[] {
  const dir = sortDir === 'asc' ? 1 : -1;
  return [...items].sort((a, b) => {
    switch (sortBy) {
      case 'priority': return dir * ((PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9));
      case 'status': return dir * ((STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9));
      case 'category': return dir * a.category.localeCompare(b.category);
      case 'title': return dir * a.title.localeCompare(b.title);
      case 'retries': return dir * (a.retry_count - b.retry_count);
      case 'created': return dir * a.created_at.localeCompare(b.created_at);
      default: return 0;
    }
  });
}

export default function FindingsPage() {
  const [findings, setFindings] = useState<AutoFinding[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedFinding, setSelectedFinding] = useState<AutoFinding | null>(null);
  const [prefsLoaded, setPrefsLoaded] = useState(false);

  // Filter & sort state (loaded from localStorage)
  const [filterStatus, setFilterStatus] = useState('');
  const [filterPriority, setFilterPriority] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [sortBy, setSortBy] = useState('priority');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  // Load saved prefs on mount
  useEffect(() => {
    const prefs = loadPrefs();
    setFilterStatus(prefs.status);
    setFilterPriority(prefs.priority);
    setFilterCategory(prefs.category);
    setSortBy(prefs.sortBy);
    setSortDir(prefs.sortDir);
    setPrefsLoaded(true);
  }, []);

  // Save prefs whenever they change
  useEffect(() => {
    if (!prefsLoaded) return;
    savePrefs({ status: filterStatus, priority: filterPriority, category: filterCategory, sortBy, sortDir });
  }, [filterStatus, filterPriority, filterCategory, sortBy, sortDir, prefsLoaded]);

  const { showToast } = useToast();

  const fetchFindings = useCallback(() => {
    if (!prefsLoaded) return;
    setError(null);
    const params = new URLSearchParams();
    if (filterStatus) params.set('status', filterStatus);
    if (filterPriority) params.set('priority', filterPriority);
    if (filterCategory) params.set('category', filterCategory);
    const qs = params.toString();

    fetch(`/api/auto/findings${qs ? `?${qs}` : ''}`)
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load findings');
        return res.json();
      })
      .then((data: AutoFinding[]) => setFindings(data))
      .catch(() => {
        setError('Failed to load findings. Please try again.');
      })
      .finally(() => setLoading(false));
  }, [filterStatus, filterPriority, filterCategory, prefsLoaded]);

  useEffect(() => {
    setLoading(true);
    fetchFindings();
  }, [fetchFindings]);

  const sortedFindings = sortFindings(findings, sortBy, sortDir);

  async function updateStatus(id: string, newStatus: FindingStatus) {
    try {
      const res = await fetch(`/api/auto/findings/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error('Failed to update status');
      setFindings((prev) =>
        prev.map((f) => (f.id === id ? { ...f, status: newStatus } : f))
      );
      showToast('Status updated', 'success');
    } catch {
      showToast('Failed to update status', 'error');
    }
  }

  async function deleteFinding(id: string) {
    try {
      const res = await fetch(`/api/auto/findings/${id}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to delete finding');
      setFindings((prev) => prev.filter((f) => f.id !== id));
      showToast('Finding deleted', 'success');
    } catch {
      showToast('Failed to delete finding', 'error');
    }
  }

  return (
    <div className="p-6">
      <h1 className="mb-6 text-2xl font-bold text-gray-900">Findings</h1>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex items-center justify-between">
          <span>{error}</span>
          <button
            onClick={() => {
              setError(null);
              fetchFindings();
            }}
            className="font-medium text-red-700 hover:text-red-900 underline"
          >
            Retry
          </button>
        </div>
      )}

      {/* Filter bar */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div>
          <label className="mr-1.5 text-sm font-medium text-gray-600">
            Status
          </label>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mr-1.5 text-sm font-medium text-gray-600">
            Priority
          </label>
          <select
            value={filterPriority}
            onChange={(e) => setFilterPriority(e.target.value)}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            {PRIORITY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mr-1.5 text-sm font-medium text-gray-600">
            Category
          </label>
          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            {CATEGORY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <label className="mr-1.5 text-sm font-medium text-gray-600">
            Sort
          </label>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <button
            onClick={() => setSortDir(sortDir === 'asc' ? 'desc' : 'asc')}
            className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
            title={sortDir === 'asc' ? 'Ascending' : 'Descending'}
          >
            {sortDir === 'asc' ? '↑' : '↓'}
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        {loading ? (
          <div className="px-6 py-12 text-center text-sm text-gray-500">
            Loading...
          </div>
        ) : sortedFindings.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-gray-500">
            No findings found.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="px-6 py-3 font-medium text-gray-600">
                    Priority
                  </th>
                  <th className="px-6 py-3 font-medium text-gray-600">
                    Category
                  </th>
                  <th className="px-6 py-3 font-medium text-gray-600">
                    Title
                  </th>
                  <th className="px-6 py-3 font-medium text-gray-600">
                    File Path
                  </th>
                  <th className="px-6 py-3 font-medium text-gray-600">
                    Status
                  </th>
                  <th className="px-6 py-3 font-medium text-gray-600">
                    Retries
                  </th>
                  <th className="px-6 py-3 font-medium text-gray-600">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sortedFindings.map((finding) => (
                  <tr key={finding.id} className="hover:bg-gray-50">
                    <td className="px-6 py-3">
                      <Badge variant={priorityBadgeVariant(finding.priority)}>
                        {finding.priority}
                      </Badge>
                    </td>
                    <td className="px-6 py-3 text-gray-600">
                      {finding.category}
                    </td>
                    <td className="px-6 py-3">
                      <button
                        onClick={() => setSelectedFinding(finding)}
                        className="font-medium text-blue-600 hover:text-blue-800 hover:underline text-left"
                      >
                        {finding.title}
                      </button>
                    </td>
                    <td className="px-6 py-3 font-mono text-xs text-gray-500">
                      {finding.file_path ?? '-'}
                    </td>
                    <td className="px-6 py-3">
                      <select
                        value={finding.status}
                        onChange={(e) =>
                          updateStatus(
                            finding.id,
                            e.target.value as FindingStatus
                          )
                        }
                        onClick={(e) => e.stopPropagation()}
                        className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      >
                        {INLINE_STATUS_OPTIONS.map((s) => (
                          <option key={s} value={s}>
                            {formatStatusLabel(s)}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-6 py-3 text-gray-600">
                      {finding.retry_count}/{finding.max_retries}
                    </td>
                    <td className="px-6 py-3">
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => deleteFinding(finding.id)}
                      >
                        Delete
                      </Button>
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
        open={selectedFinding !== null}
        onClose={() => setSelectedFinding(null)}
        title="Finding Detail"
        size="xl"
        footer={
          <Button
            variant="secondary"
            onClick={() => setSelectedFinding(null)}
          >
            Close
          </Button>
        }
      >
        {selectedFinding && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-gray-500">Priority:</span>{' '}
                <Badge
                  variant={priorityBadgeVariant(selectedFinding.priority)}
                >
                  {selectedFinding.priority}
                </Badge>
              </div>
              <div>
                <span className="text-gray-500">Status:</span>{' '}
                <Badge
                  variant={statusBadgeVariant(selectedFinding.status)}
                >
                  {formatStatusLabel(selectedFinding.status)}
                </Badge>
              </div>
              <div>
                <span className="text-gray-500">Category:</span>{' '}
                <span className="font-medium text-gray-900">
                  {selectedFinding.category}
                </span>
              </div>
              <div>
                <span className="text-gray-500">Retries:</span>{' '}
                <span className="text-gray-900">
                  {selectedFinding.retry_count}/{selectedFinding.max_retries}
                </span>
              </div>
              {selectedFinding.file_path && (
                <div className="col-span-2">
                  <span className="text-gray-500">File:</span>{' '}
                  <span className="font-mono text-xs text-gray-900">
                    {selectedFinding.file_path}
                  </span>
                </div>
              )}
            </div>
            <div>
              <p className="mb-1 text-sm font-medium text-gray-700">Title</p>
              <p className="text-sm text-gray-900">{selectedFinding.title}</p>
            </div>
            <div>
              <p className="mb-1 text-sm font-medium text-gray-700">
                Description
              </p>
              <div
                className="max-h-80 overflow-y-auto rounded p-3 text-xs leading-relaxed text-gray-100"
                style={{ backgroundColor: '#1E1E1E' }}
              >
                {selectedFinding.description ? <MarkdownOutput text={selectedFinding.description} /> : '(no description)'}
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
