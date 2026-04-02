'use client';

import { useEffect, useState, useCallback } from 'react';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import type { Settings } from '@/types';

export default function SettingsPage() {
  const { showToast } = useToast();
  const [form, setForm] = useState<Settings>({
    working_directory: '',
    claude_binary: 'claude',
    global_prompt: '',
    claude_session_key: '',
    claude_org_id: '',
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const fetchSettings = useCallback(() => {
    setError(null);
    fetch('/api/settings')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load settings');
        return res.json();
      })
      .then((data: Settings) => setForm(data))
      .catch(() => {
        setError('Failed to load settings. Please try again.');
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const errorMsg = data.error || 'Failed to save settings';
        setSaveError(errorMsg);
        showToast(errorMsg, 'error');
        return;
      }
      showToast('Settings saved', 'success');
    } catch {
      showToast('Failed to save settings', 'error');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="p-6">
        <h1 className="mb-6 text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500">Loading...</p>
      </div>
    );
  }

  return (
    <div className="p-6">
      <h1 className="mb-6 text-2xl font-bold text-gray-900">Settings</h1>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => { setError(null); fetchSettings(); }} className="font-medium text-red-700 hover:text-red-900 underline">
            Retry
          </button>
        </div>
      )}

      <div className="max-w-lg rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <div className="space-y-4">
          <div>
            <label htmlFor="settings-working-dir" className="mb-1 block text-sm font-medium text-gray-700">
              Working Directory
            </label>
            <input
              id="settings-working-dir"
              type="text"
              value={form.working_directory}
              onChange={(e) =>
                setForm({ ...form, working_directory: e.target.value })
              }
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="/path/to/project"
            />
            <p className="mt-1 text-xs text-gray-500">
              Default working directory for prompts that don&apos;t specify one.
            </p>
          </div>

          <div>
            <label htmlFor="settings-claude-binary" className="mb-1 block text-sm font-medium text-gray-700">
              Claude Binary
            </label>
            <input
              id="settings-claude-binary"
              type="text"
              value={form.claude_binary}
              onChange={(e) =>
                setForm({ ...form, claude_binary: e.target.value })
              }
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="claude"
            />
            <p className="mt-1 text-xs text-gray-500">
              Path to the Claude CLI binary.
            </p>
          </div>

          <div>
            <label htmlFor="settings-global-prompt" className="mb-1 block text-sm font-medium text-gray-700">
              Global Prompt
            </label>
            <textarea
              id="settings-global-prompt"
              value={form.global_prompt}
              onChange={(e) =>
                setForm({ ...form, global_prompt: e.target.value })
              }
              rows={4}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="Text to prepend to every prompt execution..."
            />
            <p className="mt-1 text-xs text-gray-500">
              This text is prepended to every prompt when running a plan. Useful for
              shared context or instructions.
            </p>
          </div>

          <hr className="border-gray-200" />

          <h3 className="text-sm font-semibold text-gray-900">Usage Monitoring</h3>
          <p className="text-xs text-gray-500">
            Provide Claude session key to monitor API usage across all modes.
          </p>

          <div>
            <label htmlFor="settings-session-key" className="mb-1 block text-sm font-medium text-gray-700">
              Claude Session Key
            </label>
            <input
              id="settings-session-key"
              type="password"
              value={form.claude_session_key}
              onChange={(e) => setForm({ ...form, claude_session_key: e.target.value })}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="sk-ant-sid02-..."
            />
            <p className="mt-1 text-xs text-gray-500">From browser cookies (sessionKey on claude.ai)</p>
          </div>

          <div>
            <label htmlFor="settings-org-id" className="mb-1 block text-sm font-medium text-gray-700">
              Organization ID
            </label>
            <input
              id="settings-org-id"
              type="text"
              value={form.claude_org_id}
              onChange={(e) => setForm({ ...form, claude_org_id: e.target.value })}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            />
          </div>
        </div>

        {saveError && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {saveError}
          </div>
        )}

        <div className="mt-6 flex items-center gap-3">
          <Button onClick={handleSave} loading={saving}>
            Save Settings
          </Button>
        </div>
      </div>
    </div>
  );
}
