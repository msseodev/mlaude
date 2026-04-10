import { NextResponse } from 'next/server';
import { getAutoAgents, initAutoTables } from '@/lib/autonomous/db';
import type { AutoAgent } from '@/lib/autonomous/types';

interface WorkflowStep {
  type: 'parallel' | 'serial';
  order: number;
  groupName?: string;
  agents: Array<{
    id: string;
    name: string;
    displayName: string;
    roleDescription: string;
    pipelineOrder: number;
    parallelGroup: string | null;
    enabled: boolean;
    isBuiltin: boolean;
    model: string;
  }>;
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

function mapAgent(a: AutoAgent) {
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
  const agents = getAutoAgents(); // all agents, including disabled

  const enabledAgents = agents.filter(a => a.enabled);
  const steps = buildWorkflowSteps(enabledAgents);

  return NextResponse.json({
    agents: agents.map(mapAgent),
    steps,
    feedbackLoops: [
      {
        from: 'developer',
        to: 'planning_team_lead',
        label: '기획-개발 리뷰',
        condition: 'Developer 블로커 발생 시',
      },
      {
        from: 'reviewer',
        to: 'developer',
        label: '코드 리뷰 피드백',
        condition: 'Reviewer 미승인 시',
      },
    ],
    ceoEscalation: {
      description: '모든 에이전트가 CEO에게 요청 가능',
      types: ['권한', '리소스', '의사결정', '정보'],
    },
  });
}
