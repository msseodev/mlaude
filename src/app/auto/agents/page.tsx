'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import type { AutoAgent } from '@/types';

interface AgentFormData {
  name: string;
  display_name: string;
  role_description: string;
  system_prompt: string;
  pipeline_order: number;
  model: string;
}

const MODEL_OPTIONS = [
  { value: 'claude-opus-4-6', label: 'Opus 4.6 (Recommended)' },
  { value: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { value: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
] as const;

const MODEL_SHORT_LABELS: Record<string, string> = {
  'claude-opus-4-6': 'Opus 4.6',
  'claude-sonnet-4-6': 'Sonnet 4.6',
  'claude-haiku-4-5-20251001': 'Haiku 4.5',
};

const emptyForm: AgentFormData = {
  name: '',
  display_name: '',
  role_description: '',
  system_prompt: '',
  pipeline_order: 99,
  model: 'claude-opus-4-6',
};

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

function AgentEditModal({
  open,
  onClose,
  agent,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  agent: AutoAgent | null;
  onSaved: () => void;
}) {
  const { showToast } = useToast();
  const [form, setForm] = useState<AgentFormData>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [nameManuallyEdited, setNameManuallyEdited] = useState(false);

  const isEdit = agent !== null;

  useEffect(() => {
    if (open) {
      if (agent) {
        setForm({
          name: agent.name,
          display_name: agent.display_name,
          role_description: agent.role_description,
          system_prompt: agent.system_prompt,
          pipeline_order: agent.pipeline_order,
          model: agent.model || 'claude-opus-4-6',
        });
        setNameManuallyEdited(true);
      } else {
        setForm(emptyForm);
        setNameManuallyEdited(false);
      }
    }
  }, [open, agent]);

  function handleDisplayNameChange(value: string) {
    setForm((prev) => ({
      ...prev,
      display_name: value,
      ...(nameManuallyEdited ? {} : { name: slugify(value) }),
    }));
  }

  function handleNameChange(value: string) {
    setNameManuallyEdited(true);
    setForm((prev) => ({ ...prev, name: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name || !form.display_name || !form.system_prompt) {
      showToast('Name, Display Name, and System Prompt are required', 'error');
      return;
    }

    setSaving(true);
    try {
      const url = isEdit ? `/api/auto/agents/${agent.id}` : '/api/auto/agents';
      const method = isEdit ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast(data.error || `Failed to ${isEdit ? 'update' : 'create'} agent`, 'error');
        return;
      }
      showToast(`Agent ${isEdit ? 'updated' : 'created'}`, 'success');
      onSaved();
      onClose();
    } catch {
      showToast(`Failed to ${isEdit ? 'update' : 'create'} agent`, 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit Agent' : 'New Agent'}
      size="xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} loading={saving}>
            {isEdit ? 'Save Changes' : 'Create Agent'}
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="agent-display-name" className="mb-1 block text-sm font-medium text-gray-700">
            Display Name
          </label>
          <input
            id="agent-display-name"
            type="text"
            required
            value={form.display_name}
            onChange={(e) => handleDisplayNameChange(e.target.value)}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            placeholder="e.g. Product Designer"
          />
        </div>

        <div>
          <label htmlFor="agent-name" className="mb-1 block text-sm font-medium text-gray-700">
            Name / Slug
          </label>
          <input
            id="agent-name"
            type="text"
            required
            value={form.name}
            onChange={(e) => handleNameChange(e.target.value)}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            placeholder="e.g. product_designer"
          />
          <p className="mt-1 text-xs text-gray-500">
            Unique identifier (auto-generated from display name)
          </p>
        </div>

        <div>
          <label htmlFor="agent-role-description" className="mb-1 block text-sm font-medium text-gray-700">
            Role Description
          </label>
          <input
            id="agent-role-description"
            type="text"
            value={form.role_description}
            onChange={(e) => setForm({ ...form, role_description: e.target.value })}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            placeholder="e.g. Defines feature specs, UX flows, ..."
          />
        </div>

        <div>
          <label htmlFor="agent-system-prompt" className="mb-1 block text-sm font-medium text-gray-700">
            System Prompt
          </label>
          <textarea
            id="agent-system-prompt"
            required
            value={form.system_prompt}
            onChange={(e) => setForm({ ...form, system_prompt: e.target.value })}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            style={{ minHeight: '200px' }}
            placeholder="Enter the system prompt for this agent..."
          />
        </div>

        <div>
          <label htmlFor="agent-model" className="mb-1 block text-sm font-medium text-gray-700">
            Model
          </label>
          <select
            id="agent-model"
            value={form.model}
            onChange={(e) => setForm({ ...form, model: e.target.value })}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            {MODEL_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="agent-pipeline-order" className="mb-1 block text-sm font-medium text-gray-700">
            Pipeline Order
          </label>
          <input
            id="agent-pipeline-order"
            type="number"
            min={0}
            value={form.pipeline_order}
            onChange={(e) => setForm({ ...form, pipeline_order: parseInt(e.target.value, 10) || 0 })}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <p className="mt-1 text-xs text-gray-500">
            Order in the agent pipeline (lower runs first)
          </p>
        </div>
      </form>
    </Modal>
  );
}

export default function AgentsPage() {
  const { showToast } = useToast();
  const [agents, setAgents] = useState<AutoAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editAgent, setEditAgent] = useState<AutoAgent | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  const fetchAgents = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/auto/agents');
      if (!res.ok) throw new Error('Failed to load agents');
      const data: AutoAgent[] = await res.json();
      setAgents(data.sort((a, b) => a.pipeline_order - b.pipeline_order));
    } catch {
      setError('Failed to load agents. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  async function handleToggle(id: string) {
    try {
      const res = await fetch(`/api/auto/agents/${id}/toggle`, { method: 'PATCH' });
      if (res.ok) {
        fetchAgents();
      } else {
        showToast('Failed to toggle agent', 'error');
      }
    } catch {
      showToast('Failed to toggle agent', 'error');
    }
  }

  async function handleDelete(agent: AutoAgent) {
    if (!confirm(`Delete "${agent.display_name}"?`)) return;
    try {
      const res = await fetch(`/api/auto/agents/${agent.id}`, { method: 'DELETE' });
      if (res.ok) {
        showToast('Agent deleted', 'success');
        fetchAgents();
      } else {
        const data = await res.json().catch(() => ({}));
        showToast(data.error || 'Failed to delete agent', 'error');
      }
    } catch {
      showToast('Failed to delete agent', 'error');
    }
  }

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Agent Pipeline</h1>
        <Button onClick={() => setShowCreateModal(true)}>+ New Agent</Button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex items-center justify-between">
          <span>{error}</span>
          <button
            onClick={() => {
              setError(null);
              fetchAgents();
            }}
            className="font-medium text-red-700 hover:text-red-900 underline"
          >
            Retry
          </button>
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        {loading ? (
          <div className="px-6 py-12 text-center text-sm text-gray-500">
            Loading...
          </div>
        ) : agents.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-gray-500">
            No agents configured. Create one to get started.
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {agents.map((agent) => (
              <div
                key={agent.id}
                className="flex items-start gap-4 px-6 py-4 hover:bg-gray-50"
              >
                {/* Pipeline order number */}
                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gray-100 text-sm font-semibold text-gray-600">
                  {agent.pipeline_order}
                </div>

                {/* Status dot + name + description */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full ${
                        agent.enabled ? 'bg-green-500' : 'bg-gray-400'
                      }`}
                      title={agent.enabled ? 'Enabled' : 'Disabled'}
                    />
                    <span className="text-sm font-semibold text-gray-900">
                      {agent.display_name}
                    </span>
                    {agent.is_builtin ? (
                      <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
                        Built-in
                      </span>
                    ) : null}
                    <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                      {MODEL_SHORT_LABELS[agent.model] || agent.model}
                    </span>
                  </div>
                  {agent.role_description && (
                    <p className="mt-0.5 text-sm text-gray-500">
                      {agent.role_description}
                    </p>
                  )}
                </div>

                {/* Action buttons */}
                <div className="flex flex-shrink-0 items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setEditAgent(agent)}
                  >
                    Edit
                  </Button>
                  <Button
                    variant={agent.enabled ? 'secondary' : 'success'}
                    size="sm"
                    onClick={() => handleToggle(agent.id)}
                  >
                    {agent.enabled ? 'Disable' : 'Enable'}
                  </Button>
                  {!agent.is_builtin && (
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => handleDelete(agent)}
                    >
                      Delete
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Legend */}
      {!loading && agents.length > 0 && (
        <div className="mt-3 flex items-center gap-4 text-xs text-gray-500">
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
            Enabled
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full bg-gray-400" />
            Disabled
          </span>
        </div>
      )}

      {/* Create Modal */}
      <AgentEditModal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        agent={null}
        onSaved={fetchAgents}
      />

      {/* Edit Modal */}
      <AgentEditModal
        open={editAgent !== null}
        onClose={() => setEditAgent(null)}
        agent={editAgent}
        onSaved={fetchAgents}
      />
    </div>
  );
}
