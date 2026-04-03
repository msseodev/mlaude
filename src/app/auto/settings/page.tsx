'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import type { AutoSettings } from '@/types';

export default function AutoSettingsPage() {
  const { showToast } = useToast();
  const [form, setForm] = useState<AutoSettings>({
    target_project: '',
    test_command: '',
    build_command: '',
    lint_command: '',
    max_cycles: 0,
    auto_commit: true,
    branch_name: 'auto/improvements',
    max_retries: 3,
    max_consecutive_failures: 5,
    review_max_iterations: 2,
    skip_designer_for_fixes: true,
    require_initial_prompt: false,
    max_designer_iterations: 2,
    screenshot_dir: '',
    global_prompt: '',
    parallel_mode: false,
    max_parallel_pipelines: 3,
    memory_enabled: true,
    knowledge_extraction_interval: 5,
    max_knowledge_context_chars: 3500,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const fetchSettings = useCallback(() => {
    setError(null);
    fetch('/api/auto/settings')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load settings');
        return res.json();
      })
      .then((data: AutoSettings) => setForm(data))
      .catch(() => {
        setError('Failed to load autonomous settings. Please try again.');
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
      const res = await fetch('/api/auto/settings', {
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
      showToast('Autonomous settings saved', 'success');
    } catch {
      showToast('Failed to save settings', 'error');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="p-6">
        <h1 className="mb-6 text-2xl font-bold text-gray-900">Autonomous Settings</h1>
        <p className="text-sm text-gray-500">Loading...</p>
      </div>
    );
  }

  return (
    <div className="p-6">
      <h1 className="mb-6 text-2xl font-bold text-gray-900">Autonomous Settings</h1>

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
            <label htmlFor="auto-target-project" className="mb-1 block text-sm font-medium text-gray-700">
              Target Project
            </label>
            <input
              id="auto-target-project"
              type="text"
              value={form.target_project}
              onChange={(e) =>
                setForm({ ...form, target_project: e.target.value })
              }
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="/path/to/project"
            />
          </div>

          <div>
            <label htmlFor="auto-test-command" className="mb-1 block text-sm font-medium text-gray-700">
              Test Command
            </label>
            <input
              id="auto-test-command"
              type="text"
              value={form.test_command}
              onChange={(e) =>
                setForm({ ...form, test_command: e.target.value })
              }
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="npm test"
            />
          </div>

          <div>
            <label htmlFor="auto-build-command" className="mb-1 block text-sm font-medium text-gray-700">
              Build Command
            </label>
            <input
              id="auto-build-command"
              type="text"
              value={form.build_command}
              onChange={(e) =>
                setForm({ ...form, build_command: e.target.value })
              }
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="e.g., ./gradlew build, flutter build, cargo build"
            />
            <p className="mt-1 text-xs text-gray-500">
              Leave empty to skip
            </p>
          </div>

          <div>
            <label htmlFor="auto-lint-command" className="mb-1 block text-sm font-medium text-gray-700">
              Lint Command
            </label>
            <input
              id="auto-lint-command"
              type="text"
              value={form.lint_command}
              onChange={(e) =>
                setForm({ ...form, lint_command: e.target.value })
              }
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="e.g., ./gradlew lint, flutter analyze, cargo clippy"
            />
            <p className="mt-1 text-xs text-gray-500">
              Leave empty to skip
            </p>
          </div>

          <div>
            <label htmlFor="auto-screenshot-dir" className="mb-1 block text-sm font-medium text-gray-700">
              Screenshot Directory
            </label>
            <input
              id="auto-screenshot-dir"
              type="text"
              value={form.screenshot_dir}
              onChange={(e) =>
                setForm({ ...form, screenshot_dir: e.target.value })
              }
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="Leave empty for auto-detect (.mlaude/screenshots/)"
            />
            <p className="mt-1 text-xs text-gray-500">
              Leave empty for auto-detection
            </p>
          </div>

          <div>
            <label htmlFor="auto-global-prompt" className="mb-1 block text-sm font-medium text-gray-700">
              Global Prompt
            </label>
            <textarea
              id="auto-global-prompt"
              value={form.global_prompt}
              onChange={(e) =>
                setForm({ ...form, global_prompt: e.target.value })
              }
              rows={4}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="Instructions shared across all agents..."
            />
            <p className="mt-1 text-xs text-gray-500">
              Injected after the system prompt of all agents (Planner, Developer, Reviewer, QA, etc.)
            </p>
          </div>

          <div>
            <label htmlFor="auto-max-cycles" className="mb-1 block text-sm font-medium text-gray-700">
              Max Cycles
            </label>
            <input
              id="auto-max-cycles"
              type="number"
              min={0}
              value={form.max_cycles}
              onChange={(e) =>
                setForm({ ...form, max_cycles: parseInt(e.target.value, 10) || 0 })
              }
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <p className="mt-1 text-xs text-gray-500">
              0 for unlimited
            </p>
          </div>

          <div className="flex items-center gap-3">
            <input
              id="auto-auto-commit"
              type="checkbox"
              checked={form.auto_commit}
              onChange={(e) =>
                setForm({ ...form, auto_commit: e.target.checked })
              }
              className="h-4 w-4 rounded border-gray-300 text-blue-500 focus:ring-blue-500"
            />
            <label htmlFor="auto-auto-commit" className="text-sm font-medium text-gray-700">
              Automatically create git checkpoints
            </label>
          </div>

          <div>
            <label htmlFor="auto-branch-name" className="mb-1 block text-sm font-medium text-gray-700">
              Branch Name
            </label>
            <input
              id="auto-branch-name"
              type="text"
              value={form.branch_name}
              onChange={(e) =>
                setForm({ ...form, branch_name: e.target.value })
              }
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div>
            <label htmlFor="auto-max-retries" className="mb-1 block text-sm font-medium text-gray-700">
              Max Retries
            </label>
            <input
              id="auto-max-retries"
              type="number"
              min={0}
              value={form.max_retries}
              onChange={(e) =>
                setForm({ ...form, max_retries: parseInt(e.target.value, 10) || 0 })
              }
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <p className="mt-1 text-xs text-gray-500">
              Max fix attempts per finding
            </p>
          </div>

          <div>
            <label htmlFor="auto-max-consecutive-failures" className="mb-1 block text-sm font-medium text-gray-700">
              Max Consecutive Failures
            </label>
            <input
              id="auto-max-consecutive-failures"
              type="number"
              min={0}
              value={form.max_consecutive_failures}
              onChange={(e) =>
                setForm({ ...form, max_consecutive_failures: parseInt(e.target.value, 10) || 0 })
              }
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <p className="mt-1 text-xs text-gray-500">
              Auto-pause after N consecutive failures
            </p>
          </div>

          <div>
            <label htmlFor="auto-review-max-iterations" className="mb-1 block text-sm font-medium text-gray-700">
              Review Max Iterations
            </label>
            <input
              id="auto-review-max-iterations"
              type="number"
              min={0}
              value={form.review_max_iterations}
              onChange={(e) => setForm({ ...form, review_max_iterations: parseInt(e.target.value, 10) || 0 })}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <p className="mt-1 text-xs text-gray-500">
              Max Reviewer ↔ Developer feedback iterations per cycle
            </p>
          </div>

          <div className="flex items-center gap-3">
            <input
              id="auto-skip-designer"
              type="checkbox"
              checked={form.skip_designer_for_fixes}
              onChange={(e) => setForm({ ...form, skip_designer_for_fixes: e.target.checked })}
              className="h-4 w-4 rounded border-gray-300 text-blue-500 focus:ring-blue-500"
            />
            <label htmlFor="auto-skip-designer" className="text-sm font-medium text-gray-700">
              Skip planning agents for fix cycles
            </label>
          </div>

          <div className="flex items-center gap-3">
            <input
              id="auto-require-prompt"
              type="checkbox"
              checked={form.require_initial_prompt}
              onChange={(e) => setForm({ ...form, require_initial_prompt: e.target.checked })}
              className="h-4 w-4 rounded border-gray-300 text-blue-500 focus:ring-blue-500"
            />
            <label htmlFor="auto-require-prompt" className="text-sm font-medium text-gray-700">
              Require initial prompt to start
            </label>
          </div>

          <hr className="border-gray-200" />

          <div className="flex items-center gap-3">
            <input
              id="auto-parallel-mode"
              type="checkbox"
              checked={form.parallel_mode}
              onChange={(e) => setForm({ ...form, parallel_mode: e.target.checked })}
              className="h-4 w-4 rounded border-gray-300 text-blue-500 focus:ring-blue-500"
            />
            <label htmlFor="auto-parallel-mode" className="text-sm font-medium text-gray-700">
              Parallel Finding Processing
            </label>
          </div>

          {form.parallel_mode && (
            <div>
              <label htmlFor="auto-max-parallel-pipelines" className="mb-1 block text-sm font-medium text-gray-700">
                Max Parallel Pipelines
              </label>
              <input
                id="auto-max-parallel-pipelines"
                type="number"
                min={2}
                max={10}
                value={form.max_parallel_pipelines}
                onChange={(e) => setForm({ ...form, max_parallel_pipelines: parseInt(e.target.value, 10) || 3 })}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <p className="mt-1 text-xs text-gray-500">
                Process up to N findings simultaneously using git worktrees
              </p>
            </div>
          )}

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
