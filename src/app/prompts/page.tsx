'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/Button';
import { Badge, statusBadgeVariant } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import type { Prompt } from '@/types';

interface PromptWithPlans extends Prompt {
  plans: { plan_id: string; plan_name: string }[];
}

interface PromptFormData {
  title: string;
  content: string;
  working_directory: string;
}

interface PlanGroup {
  plan_id: string | null;
  plan_name: string;
  prompts: PromptWithPlans[];
}

const emptyForm: PromptFormData = { title: '', content: '', working_directory: '' };

export default function PromptsPage() {
  const { showToast } = useToast();
  const [prompts, setPrompts] = useState<PromptWithPlans[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<PromptFormData>(emptyForm);
  const [formErrors, setFormErrors] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; title: string } | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const fetchPrompts = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/prompts');
      if (!res.ok) throw new Error('Failed to load prompts');
      const data: PromptWithPlans[] = await res.json();
      setPrompts(data);
    } catch {
      setError('Failed to load prompts. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPrompts();
  }, [fetchPrompts]);

  const groups = useMemo<PlanGroup[]>(() => {
    const planMap = new Map<string, PlanGroup>();
    const assignedIds = new Set<string>();

    // Collect all plan groups
    for (const prompt of prompts) {
      for (const plan of prompt.plans) {
        if (!planMap.has(plan.plan_id)) {
          planMap.set(plan.plan_id, {
            plan_id: plan.plan_id,
            plan_name: plan.plan_name,
            prompts: [],
          });
        }
        planMap.get(plan.plan_id)!.prompts.push(prompt);
        assignedIds.add(prompt.id);
      }
    }

    // Build result: plan groups first (sorted by name), then No Plan
    const result: PlanGroup[] = [];
    const sortedPlans = [...planMap.values()].sort((a, b) =>
      a.plan_name.localeCompare(b.plan_name)
    );
    result.push(...sortedPlans);

    // Unassigned prompts
    const unassigned = prompts.filter((p) => !assignedIds.has(p.id));
    if (unassigned.length > 0) {
      result.push({
        plan_id: null,
        plan_name: 'No Plan',
        prompts: unassigned,
      });
    }

    return result;
  }, [prompts]);

  function toggleGroup(key: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setFormErrors({});
    setModalOpen(true);
  }

  function openEdit(prompt: Prompt) {
    setEditingId(prompt.id);
    setForm({
      title: prompt.title,
      content: prompt.content,
      working_directory: prompt.working_directory ?? '',
    });
    setFormErrors({});
    setModalOpen(true);
  }

  async function handleSave() {
    const errors: Record<string, boolean> = {};
    if (!form.title.trim()) errors.title = true;
    if (!form.content.trim()) errors.content = true;
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }
    setFormErrors({});
    setSaving(true);
    try {
      const body = {
        title: form.title.trim(),
        content: form.content.trim(),
        working_directory: form.working_directory.trim() || null,
      };

      let res: Response;
      if (editingId) {
        res = await fetch(`/api/prompts/${editingId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      } else {
        res = await fetch('/api/prompts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast(data.error || 'Failed to save prompt', 'error');
        return;
      }
      showToast(editingId ? 'Prompt updated' : 'Prompt created', 'success');
      setModalOpen(false);
      await fetchPrompts();
    } catch {
      showToast('Failed to save prompt', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      const res = await fetch(`/api/prompts/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast(data.error || 'Failed to delete prompt', 'error');
        return;
      }
      showToast('Prompt deleted', 'success');
    } catch {
      showToast('Failed to delete prompt', 'error');
    }
    setDeleteConfirm(null);
    await fetchPrompts();
  }

  function groupKey(group: PlanGroup) {
    return group.plan_id ?? '__no_plan__';
  }

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Prompt Queue</h1>
        <Button onClick={openCreate}>Add Prompt</Button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex items-center justify-between dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          <span>{error}</span>
          <button onClick={() => { setError(null); fetchPrompts(); }} className="font-medium underline hover:text-red-900 dark:hover:text-red-100">
            Retry
          </button>
        </div>
      )}

      {loading ? (
        <div className="py-12 text-center text-sm text-gray-500 dark:text-gray-400">
          Loading...
        </div>
      ) : prompts.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white py-12 text-center dark:border-gray-700 dark:bg-gray-800">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            No prompts yet. Add one to get started.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((group) => {
            const key = groupKey(group);
            const collapsed = collapsedGroups.has(key);
            const statusCounts = {
              pending: group.prompts.filter((p) => p.status === 'pending').length,
              completed: group.prompts.filter((p) => p.status === 'completed').length,
              failed: group.prompts.filter((p) => p.status === 'failed').length,
              running: group.prompts.filter((p) => p.status === 'running').length,
            };

            return (
              <div key={key} className="rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
                {/* Group Header */}
                <button
                  onClick={() => toggleGroup(key)}
                  className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-750 rounded-t-lg"
                >
                  <div className="flex items-center gap-2">
                    <svg
                      className={`h-4 w-4 text-gray-400 transition-transform ${collapsed ? '' : 'rotate-90'}`}
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
                    </svg>
                    <span className="font-semibold text-gray-900 dark:text-gray-100">
                      {group.plan_name}
                    </span>
                    <span className="text-sm text-gray-400 dark:text-gray-500">
                      ({group.prompts.length})
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {statusCounts.running > 0 && (
                      <Badge variant="blue">{statusCounts.running} running</Badge>
                    )}
                    {statusCounts.completed > 0 && (
                      <Badge variant="green">{statusCounts.completed} done</Badge>
                    )}
                    {statusCounts.failed > 0 && (
                      <Badge variant="red">{statusCounts.failed} failed</Badge>
                    )}
                    {statusCounts.pending > 0 && (
                      <Badge variant="gray">{statusCounts.pending} pending</Badge>
                    )}
                  </div>
                </button>

                {/* Group Body */}
                {!collapsed && (
                  <div className="border-t border-gray-100 dark:border-gray-700">
                    {group.prompts.map((prompt) => (
                      <div
                        key={prompt.id}
                        className="flex items-start gap-3 border-b border-gray-50 px-4 py-3 last:border-b-0 dark:border-gray-750"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="mb-1 flex items-center gap-2">
                            <span className="font-medium text-gray-900 dark:text-gray-100">
                              {prompt.title}
                            </span>
                            <Badge variant={statusBadgeVariant(prompt.status)}>
                              {prompt.status}
                            </Badge>
                          </div>
                          <p className="mb-1 line-clamp-2 text-sm text-gray-500 dark:text-gray-400">
                            {prompt.content}
                          </p>
                          {prompt.working_directory && (
                            <p className="text-xs text-gray-400 dark:text-gray-500">
                              Dir: {prompt.working_directory}
                            </p>
                          )}
                        </div>

                        <div className="flex gap-1">
                          <button
                            onClick={() => openEdit(prompt)}
                            className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
                            aria-label="Edit prompt"
                          >
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125" />
                            </svg>
                          </button>
                          <button
                            onClick={() => setDeleteConfirm({ id: prompt.id, title: prompt.title })}
                            className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950 dark:hover:text-red-400"
                            aria-label="Delete prompt"
                          >
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Create/Edit Modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingId ? 'Edit Prompt' : 'Add Prompt'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} loading={saving}>
              {editingId ? 'Save' : 'Create'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label htmlFor="prompt-title" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Title
            </label>
            <input
              id="prompt-title"
              type="text"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              className={`w-full rounded-md border px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:bg-gray-800 dark:text-gray-100 ${formErrors.title ? 'border-red-500' : 'border-gray-300 dark:border-gray-600'}`}
              placeholder="Prompt title"
            />
            {formErrors.title && <p className="mt-1 text-xs text-red-500">Title is required</p>}
          </div>
          <div>
            <label htmlFor="prompt-content" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Content
            </label>
            <textarea
              id="prompt-content"
              value={form.content}
              onChange={(e) => setForm({ ...form, content: e.target.value })}
              rows={6}
              className={`w-full rounded-md border px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:bg-gray-800 dark:text-gray-100 ${formErrors.content ? 'border-red-500' : 'border-gray-300 dark:border-gray-600'}`}
              placeholder="Prompt content..."
            />
            {formErrors.content && <p className="mt-1 text-xs text-red-500">Content is required</p>}
          </div>
          <div>
            <label htmlFor="prompt-working-dir" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Working Directory (optional)
            </label>
            <input
              id="prompt-working-dir"
              type="text"
              value={form.working_directory}
              onChange={(e) =>
                setForm({ ...form, working_directory: e.target.value })
              }
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              placeholder="/path/to/project"
            />
          </div>
        </div>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        open={deleteConfirm !== null}
        onClose={() => setDeleteConfirm(null)}
        title="Delete Prompt"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleteConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => deleteConfirm && handleDelete(deleteConfirm.id)}
            >
              Delete
            </Button>
          </>
        }
      >
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Are you sure you want to delete &quot;{deleteConfirm?.title}&quot;? This action cannot be
          undone.
        </p>
      </Modal>
    </div>
  );
}
