import { NextResponse } from 'next/server';
import { getAutoAgents, initAutoTables } from '@/lib/autonomous/db';
import { filterAgentsByPipelineType } from '@/lib/autonomous/pipeline-executor';
import type { AutoAgent, PipelineType } from '@/lib/autonomous/types';

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
  pipelineType: PipelineType;
  label: string;
  description: string;
  steps: WorkflowStep[];
}

function buildWorkflowSteps(agents: AutoAgent[]): WorkflowStep[] {
  const sorted = [...agents].sort((a, b) => a.pipeline_order - b.pipeline_order);
  const steps: WorkflowStep[] = [];
  const groups = new Map<string, AutoAgent[]>();

  for (const agent of sorted) {
    if (agent.parallel_group) {
      if (!groups.has(agent.parallel_group)) {
        groups.set(agent.parallel_group, []);
      }
      groups.get(agent.parallel_group)!.push(agent);
    } else {
      steps.push({
        type: 'serial',
        order: agent.pipeline_order,
        agents: [mapAgent(agent)],
      });
    }
  }

  for (const [groupName, groupAgents] of groups) {
    const minOrder = Math.min(...groupAgents.map(a => a.pipeline_order));
    steps.push({
      type: 'parallel',
      order: minOrder,
      groupName,
      agents: groupAgents.map(mapAgent),
    });
  }

  steps.sort((a, b) => a.order - b.order);
  return steps;
}

function mapAgent(a: AutoAgent): WorkflowAgent {
  return {
    id: a.id,
    name: a.name,
    displayName: a.display_name,
    roleDescription: a.role_description,
    pipelineOrder: a.pipeline_order,
    parallelGroup: a.parallel_group,
    enabled: !!a.enabled,
    isBuiltin: !!a.is_builtin,
    model: a.model,
  };
}

// GET /api/auto/workflow
export async function GET() {
  initAutoTables();
  const allAgents = getAutoAgents(); // includes disabled
  const enabledAgents = allAgents.filter(a => a.enabled);

  const pipelines: PipelineView[] = [
    {
      pipelineType: 'discovery',
      label: 'Discovery (cycle 0 / forced)',
      description:
        'Initial cycle: planning team produces findings, then the developer agent picks the first finding and runs tdd-flutter --auto. smoke_tester verifies on a real device.',
      steps: buildWorkflowSteps(filterAgentsByPipelineType(enabledAgents, 'discovery')),
    },
    {
      pipelineType: 'fix',
      label: 'Fix (most cycles)',
      description:
        'Default cycle for resolving findings. Developer invokes tdd-flutter --auto, which internally runs planner → tester → flutter-coder → /review-uncommit (4 parallel reviewers) → flutter-coder fix → flutter test/analyze. smoke_tester runs at the end on a real device.',
      steps: buildWorkflowSteps(filterAgentsByPipelineType(enabledAgents, 'fix')),
    },
    {
      pipelineType: 'test_fix',
      label: 'Test Fix',
      description: 'Triggered when a finding has category=test_failure. Only the test_engineer agent runs.',
      steps: buildWorkflowSteps(filterAgentsByPipelineType(enabledAgents, 'test_fix')),
    },
  ];

  return NextResponse.json({
    agents: allAgents.map(mapAgent),
    pipelines,
    feedbackLoops: [
      {
        from: 'developer',
        to: 'planning_team_lead',
        label: '기획-개발 리뷰',
        condition: 'Developer 블로커 발생 시',
      },
      {
        from: 'developer',
        to: 'developer',
        label: 'tdd-flutter 내부 review-fix',
        condition: '/review-uncommit 후 critical/warning 발견 시 (최대 2회)',
      },
      {
        from: 'smoke_tester',
        to: 'developer',
        label: 'Smoke 실패 → finding retry',
        condition: 'smoke_tester가 실기기에서 PDF 렌더링 실패 보고 시',
      },
    ],
    ceoEscalation: {
      description: '모든 에이전트가 CEO에게 요청 가능',
      types: ['권한', '리소스', '의사결정', '정보'],
    },
  });
}
