'use client';

import { useState, useEffect, useCallback } from 'react';

// --- Types ---

interface WorkflowAgent {
  id: string;
  name: string;
  displayName: string;
  roleDescription: string;
  pipelineOrder: number;
  parallelGroup: string | null;
  enabled: boolean;
  isBuiltin: boolean;
  model: string;
}

interface WorkflowStep {
  type: 'parallel' | 'serial';
  order: number;
  groupName?: string;
  agents: WorkflowAgent[];
}

interface PipelineView {
  pipelineType: 'discovery' | 'fix' | 'test_fix';
  label: string;
  description: string;
  steps: WorkflowStep[];
}

interface FeedbackLoop {
  from: string;
  to: string;
  label: string;
  condition: string;
}

interface CEOEscalation {
  description: string;
  types: string[];
}

interface WorkflowData {
  agents: WorkflowAgent[];
  pipelines: PipelineView[];
  feedbackLoops: FeedbackLoop[];
  ceoEscalation: CEOEscalation;
}

// --- Color helpers ---

function getStepBorderColor(step: WorkflowStep): string {
  if (step.type === 'parallel') return 'border-blue-500/30';
  const name = step.agents[0]?.name;
  switch (name) {
    case 'planning_team_lead': return 'border-purple-500/30';
    case 'developer': return 'border-green-500/30';
    case 'reviewer': return 'border-orange-500/30';
    case 'qa_engineer': return 'border-cyan-500/30';
    case 'smoke_tester': return 'border-pink-500/30';
    case 'test_engineer': return 'border-amber-500/30';
    default: return 'border-zinc-600';
  }
}

function getStepBgColor(step: WorkflowStep): string {
  if (step.type === 'parallel') return 'bg-blue-950/20';
  const name = step.agents[0]?.name;
  switch (name) {
    case 'planning_team_lead': return 'bg-purple-950/20';
    case 'developer': return 'bg-green-950/20';
    case 'reviewer': return 'bg-orange-950/20';
    case 'qa_engineer': return 'bg-cyan-950/20';
    case 'smoke_tester': return 'bg-pink-950/20';
    case 'test_engineer': return 'bg-amber-950/20';
    default: return 'bg-zinc-800/50';
  }
}

function getStepHeaderColor(step: WorkflowStep): string {
  if (step.type === 'parallel') return 'text-blue-400';
  const name = step.agents[0]?.name;
  switch (name) {
    case 'planning_team_lead': return 'text-purple-400';
    case 'developer': return 'text-green-400';
    case 'reviewer': return 'text-orange-400';
    case 'qa_engineer': return 'text-cyan-400';
    case 'smoke_tester': return 'text-pink-400';
    case 'test_engineer': return 'text-amber-400';
    default: return 'text-zinc-300';
  }
}

function getAgentCardBorder(agent: WorkflowAgent): string {
  switch (agent.name) {
    case 'ux_planner':
    case 'tech_planner':
    case 'biz_planner':
      return 'border-blue-500/40';
    case 'planning_team_lead': return 'border-purple-500/40';
    case 'developer': return 'border-green-500/40';
    case 'reviewer': return 'border-orange-500/40';
    case 'qa_engineer': return 'border-cyan-500/40';
    case 'smoke_tester': return 'border-pink-500/40';
    case 'test_engineer': return 'border-amber-500/40';
    case 'product_designer': return 'border-zinc-600';
    default: return 'border-zinc-600';
  }
}

function getPhaseLabel(step: WorkflowStep, index: number): string {
  if (step.type === 'parallel') {
    return `Phase ${index + 1}: Parallel Planning`;
  }
  const name = step.agents[0]?.name;
  switch (name) {
    case 'planning_team_lead': return `Phase ${index + 1}: Planning`;
    case 'developer': return `Phase ${index + 1}: Development (tdd-flutter --auto)`;
    case 'reviewer': return `Phase ${index + 1}: Review`;
    case 'qa_engineer': return `Phase ${index + 1}: QA`;
    case 'smoke_tester': return `Phase ${index + 1}: Smoke Test (real device)`;
    case 'test_engineer': return `Phase ${index + 1}: Test Fix`;
    default: return `Phase ${index + 1}: ${step.agents[0]?.displayName ?? ''}`;
  }
}

// --- Display name map ---

const agentDisplayName: Record<string, string> = {
  planning_team_lead: 'Planning Team Lead',
  developer: 'Developer',
  reviewer: 'Reviewer',
  qa_engineer: 'QA Engineer',
  smoke_tester: 'Smoke Tester',
  test_engineer: 'Test Engineer',
  product_designer: 'Product Designer',
};

// --- Main page component ---

export default function AutoWorkflowPage() {
  const [data, setData] = useState<WorkflowData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchWorkflow = useCallback(async () => {
    try {
      const res = await fetch('/api/auto/workflow');
      if (!res.ok) {
        throw new Error('Failed to load workflow data.');
      }
      const json: WorkflowData = await res.json();
      setData(json);
      setError(null);
    } catch {
      setError('Failed to load workflow data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchWorkflow();
  }, [fetchWorkflow]);

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-900 p-6">
        <h1 className="mb-6 text-2xl font-bold text-zinc-100">Workflow Diagram</h1>
        <p className="text-sm text-zinc-500">Loading...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-zinc-900 p-6">
        <h1 className="mb-6 text-2xl font-bold text-zinc-100">Workflow Diagram</h1>
        <div className="rounded-lg border border-zinc-700 bg-zinc-800 p-8 text-center">
          <p className="text-zinc-400">{error ?? 'No data available.'}</p>
          <button
            onClick={fetchWorkflow}
            className="mt-3 text-sm font-medium text-blue-400 hover:text-blue-300 underline"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const disabledAgents = data.agents.filter(a => !a.enabled);

  return (
    <div className="min-h-screen bg-zinc-900 p-6">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-zinc-100">Workflow Diagram</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Visual representation of agent pipelines per cycle type. The active pipeline depends on the finding category and cycle index.
        </p>
      </div>

      {/* Pipelines */}
      <div className="mx-auto max-w-4xl space-y-12">
        {data.pipelines.map((pipeline) => (
          <PipelineSection
            key={pipeline.pipelineType}
            pipeline={pipeline}
            feedbackLoops={data.feedbackLoops}
          />
        ))}

        {/* CEO Escalation */}
        <div className="rounded-lg border border-red-500/30 bg-red-950/20 p-5">
          <h3 className="mb-3 text-sm font-semibold text-red-400">CEO Escalation</h3>
          <p className="mb-3 text-sm text-zinc-300">{data.ceoEscalation.description}</p>
          <div className="flex flex-wrap gap-2">
            {data.ceoEscalation.types.map((type) => (
              <span
                key={type}
                className="inline-flex items-center rounded-full bg-red-900/40 px-2.5 py-0.5 text-xs font-medium text-red-300"
              >
                {type}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Disabled agents section */}
      {disabledAgents.length > 0 && (
        <div className="mx-auto mt-10 max-w-4xl">
          <h2 className="mb-4 text-lg font-semibold text-zinc-400">Disabled Agents</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {disabledAgents.map((agent) => (
              <div
                key={agent.id}
                className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-4 opacity-50"
              >
                <div className="mb-1 flex items-center gap-2">
                  <span className="text-sm font-medium text-zinc-500 line-through">
                    {agentDisplayName[agent.name] ?? agent.displayName}
                  </span>
                  <span className="inline-flex items-center rounded-full bg-zinc-700 px-2 py-0.5 text-[10px] font-medium text-zinc-400">
                    Disabled
                  </span>
                </div>
                <p className="text-xs text-zinc-600 line-clamp-2">{agent.roleDescription}</p>
                <p className="mt-1 text-[10px] text-zinc-600">{agent.model}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="mx-auto mt-10 max-w-4xl">
        <h2 className="mb-4 text-lg font-semibold text-zinc-400">Legend</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <LegendItem color="bg-blue-500/30" label="Parallel Planning" />
          <LegendItem color="bg-purple-500/30" label="Planning Team Lead" />
          <LegendItem color="bg-green-500/30" label="Development (tdd-flutter)" />
          <LegendItem color="bg-pink-500/30" label="Smoke Tester (real device)" />
          <LegendItem color="bg-amber-500/30" label="Test Engineer" />
          <LegendItem color="bg-cyan-500/30" label="QA Engineer" />
          <LegendItem color="bg-red-500/30" label="CEO Escalation" />
          <LegendItem color="bg-yellow-500/30" label="Feedback Loop" />
        </div>
      </div>
    </div>
  );
}

// --- Sub-components ---

function PipelineSection({
  pipeline,
  feedbackLoops,
}: {
  pipeline: PipelineView;
  feedbackLoops: FeedbackLoop[];
}) {
  const pipelineTypeColor = {
    discovery: 'border-purple-500/40 bg-purple-950/10',
    fix: 'border-green-500/40 bg-green-950/10',
    test_fix: 'border-amber-500/40 bg-amber-950/10',
  }[pipeline.pipelineType];

  return (
    <section className={`rounded-xl border-2 ${pipelineTypeColor} p-6`}>
      <header className="mb-4">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-bold text-zinc-100">{pipeline.label}</h2>
          <code className="rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
            pipelineType=&quot;{pipeline.pipelineType}&quot;
          </code>
        </div>
        <p className="mt-1.5 text-sm text-zinc-400">{pipeline.description}</p>
      </header>

      {pipeline.steps.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-700 bg-zinc-800/30 p-6 text-center">
          <p className="text-sm text-zinc-500">No enabled agents for this pipeline.</p>
        </div>
      ) : (
        <div className="relative">
          {pipeline.steps.map((step, idx) => {
            const agentName = step.agents[0]?.name;
            const outboundLoop = feedbackLoops.find(f => f.from === agentName);

            return (
              <div key={idx}>
                <div className="relative">
                  {outboundLoop && (
                    <div className="absolute -right-4 top-1/2 -translate-y-1/2 sm:-right-52">
                      <div className="hidden sm:block">
                        <FeedbackLoopBadge
                          label={outboundLoop.label}
                          condition={outboundLoop.condition}
                          direction="right"
                        />
                      </div>
                    </div>
                  )}

                  <StepCard step={step} index={idx} />

                  {outboundLoop && (
                    <div className="mt-2 sm:hidden">
                      <FeedbackLoopBadge
                        label={outboundLoop.label}
                        condition={outboundLoop.condition}
                        direction="below"
                      />
                    </div>
                  )}
                </div>

                {idx < pipeline.steps.length - 1 && <DownArrow />}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function StepCard({ step, index }: { step: WorkflowStep; index: number }) {
  const borderColor = getStepBorderColor(step);
  const bgColor = getStepBgColor(step);
  const headerColor = getStepHeaderColor(step);
  const phaseLabel = getPhaseLabel(step, index);

  return (
    <div className={`rounded-lg border ${borderColor} ${bgColor} p-5`}>
      <div className="mb-4 flex items-center gap-3">
        <h3 className={`text-sm font-semibold ${headerColor}`}>{phaseLabel}</h3>
        {step.type === 'parallel' && (
          <span className="inline-flex items-center rounded-full border border-dashed border-blue-500/40 bg-blue-900/20 px-2 py-0.5 text-[10px] font-medium text-blue-400">
            Parallel
          </span>
        )}
      </div>

      <div className={`grid gap-3 ${step.type === 'parallel' ? 'sm:grid-cols-2 lg:grid-cols-3' : ''}`}>
        {step.agents.map((agent) => (
          <AgentCard key={agent.id} agent={agent} />
        ))}
      </div>
    </div>
  );
}

function AgentCard({ agent }: { agent: WorkflowAgent }) {
  const borderColor = getAgentCardBorder(agent);
  const displayName = agentDisplayName[agent.name] ?? agent.displayName;

  return (
    <div className={`rounded-lg border ${borderColor} bg-zinc-800/80 p-4`}>
      <div className="mb-2 flex items-center gap-2">
        <span className="text-sm font-medium text-zinc-100">{displayName}</span>
        <span className="inline-flex items-center rounded-full bg-green-900/40 px-2 py-0.5 text-[10px] font-medium text-green-400">
          Active
        </span>
      </div>
      <p className="mb-2 text-xs text-zinc-400 line-clamp-2">{agent.roleDescription}</p>
      <p className="text-[10px] text-zinc-500">{agent.model}</p>
    </div>
  );
}

function DownArrow() {
  return (
    <div className="flex justify-center py-2">
      <svg width="24" height="32" viewBox="0 0 24 32" fill="none" className="text-zinc-500">
        <line x1="12" y1="0" x2="12" y2="24" stroke="currentColor" strokeWidth="2" />
        <polygon points="6,24 12,32 18,24" fill="currentColor" />
      </svg>
    </div>
  );
}

function FeedbackLoopBadge({
  label,
  condition,
  direction,
}: {
  label: string;
  condition: string;
  direction: 'right' | 'below';
}) {
  if (direction === 'below') {
    return (
      <div className="rounded-md border border-dashed border-yellow-500/30 bg-yellow-950/20 px-3 py-2">
        <div className="flex items-center gap-2">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0 text-yellow-500/60">
            <path d="M4 8a4 4 0 1 1 8 0" stroke="currentColor" strokeWidth="1.5" fill="none" />
            <polygon points="11,6 13,8 11,10" fill="currentColor" />
          </svg>
          <span className="text-xs font-medium text-yellow-400">{label}</span>
        </div>
        <p className="mt-1 text-[10px] text-yellow-500/60">{condition}</p>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <svg width="24" height="40" viewBox="0 0 24 40" fill="none" className="shrink-0 text-yellow-500/50">
        <path d="M0 20 C8 20, 16 8, 16 2" stroke="currentColor" strokeWidth="1.5" fill="none" strokeDasharray="3 2" />
        <path d="M0 20 C8 20, 16 32, 16 38" stroke="currentColor" strokeWidth="1.5" fill="none" strokeDasharray="3 2" />
        <polygon points="14,0 18,4 14,4" fill="currentColor" />
        <polygon points="14,36 18,36 14,40" fill="currentColor" />
      </svg>
      <div className="rounded-md border border-dashed border-yellow-500/30 bg-yellow-950/20 px-3 py-2">
        <p className="text-xs font-medium text-yellow-400">{label}</p>
        <p className="mt-0.5 text-[10px] text-yellow-500/60">{condition}</p>
      </div>
    </div>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`inline-block h-3 w-3 rounded ${color}`} />
      <span className="text-sm text-zinc-400">{label}</span>
    </div>
  );
}
