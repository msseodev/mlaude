import type { AutoAgent, AutoFinding, FailureHistoryEntry, CEORequest, PipelineType } from './types';
import { getEpicFindings } from './db';

export interface StructuredAgentOutput {
  agentName: string;
  summary: string;
  fullOutputId: string;
  structuredData: Record<string, unknown> | null;
}

export interface AgentContext {
  userPrompt: string;
  sessionState: string;
  previousOutputs: Map<string, string>;
  structuredOutputs?: StructuredAgentOutput[];
  finding?: AutoFinding | null;
  reviewFeedback?: string;
  designerFeedback?: string;
  gitDiff?: string;
  screenFrames?: string[];  // Array of image file paths for visual analysis
  ceoRequests?: CEORequest[];
  pipelineType?: PipelineType;
  globalPrompt?: string;
  projectKnowledge?: string;
  teamMessages?: string;
  wontFixSummary?: string;
}

export function buildAgentContext(agent: AutoAgent, ctx: AgentContext): string {
  const parts: string[] = [];

  // 1. Agent system prompt
  parts.push(agent.system_prompt);

  // 1.5. Global prompt (applies to all agents)
  if (ctx.globalPrompt) {
    parts.push(`\n[Global Instructions]\n${ctx.globalPrompt}`);
  }

  // 2. CEO responses (highest priority — placed right after system prompt)
  if (ctx.ceoRequests && ctx.ceoRequests.length > 0) {
    const answered = ctx.ceoRequests.filter(r => r.status === 'approved' || r.status === 'rejected' || r.status === 'answered');
    const pending = ctx.ceoRequests.filter(r => r.status === 'pending');

    if (answered.length > 0) {
      const ceoParts: string[] = [
        '\n⚠️ IMPORTANT: CEO 지시사항 — 반드시 아래 내용을 작업에 반영하세요.',
        '',
      ];
      for (const r of answered) {
        const statusKo = r.status === 'approved' ? '승인' : r.status === 'rejected' ? '거부' : '답변';
        ceoParts.push(`[${statusKo}] ${r.title}`);
        ceoParts.push(`  요청: ${r.description}`);
        ceoParts.push(`  CEO 응답: ${r.ceo_response}`);
        ceoParts.push('');
      }
      parts.push(ceoParts.join('\n'));
    }

    if (pending.length > 0) {
      const pendingParts = ['[CEO 대기중 요청 — 중복 요청하지 마세요]'];
      for (const r of pending) {
        pendingParts.push(`- ${r.title} (${r.type})`);
      }
      parts.push(pendingParts.join('\n'));
    }
  }

  // 2.5. Project Knowledge (cross-session organizational memory)
  if (ctx.projectKnowledge) {
    parts.push(`\n[Project Knowledge]\n${ctx.projectKnowledge}`);
  }

  // 2.6. Team Messages (cross-cycle broadcast)
  if (ctx.teamMessages) {
    parts.push(`\n[Team Messages]\n${ctx.teamMessages}`);
  }

  // 2.7. Known Limitations (wont_fix findings to avoid re-generating — planners only)
  if (ctx.wontFixSummary) {
    parts.push(`\n[Known Limitations - Do Not Re-Report]\n${ctx.wontFixSummary}`);
  }

  // 3. User Prompt
  if (ctx.userPrompt) {
    parts.push(`\n[User Prompt]\n${ctx.userPrompt}`);
  }

  // 3. Session State
  if (ctx.sessionState) {
    parts.push(`\n[Session State]\n${ctx.sessionState}`);
  }

  // 4. Finding info (for fix cycles)
  if (ctx.finding) {
    const findingParts = [
      `\n[Issue to Fix]`,
      `- Title: ${ctx.finding.title}`,
      `- Description: ${ctx.finding.description}`,
      `- File: ${ctx.finding.file_path ?? 'N/A'}`,
    ];

    if (ctx.finding.failure_history) {
      try {
        const history: FailureHistoryEntry[] = JSON.parse(ctx.finding.failure_history);
        if (history.length > 0) {
          findingParts.push('');
          findingParts.push('IMPORTANT: Previous approaches failed. Try a different strategy.');
          for (const entry of history) {
            findingParts.push(`- Attempt (${entry.timestamp}): ${entry.approach} -> Failed: ${entry.failure_reason}`);
          }
        }
      } catch { /* ignore malformed history */ }
    }

    // Epic context: show sibling findings and progress
    if (ctx.finding.epic_id) {
      const siblings = getEpicFindings(ctx.finding.epic_id);
      if (siblings.length > 1) {
        findingParts.push('');
        findingParts.push(`[Epic Progress] This is step ${ctx.finding.epic_order ?? '?'} of ${siblings.length} in a multi-cycle feature:`);
        for (const sib of siblings) {
          const mark = sib.status === 'resolved' ? 'done' : sib.id === ctx.finding.id ? 'current' : 'pending';
          findingParts.push(`  ${mark === 'done' ? '[x]' : mark === 'current' ? '[>]' : '[ ]'} ${sib.epic_order ?? '?'}. ${sib.title}`);
        }
        const resolved = siblings.filter(s => s.status === 'resolved');
        if (resolved.length > 0) {
          findingParts.push('');
          findingParts.push('Previously completed steps provide context for this implementation.');
        }
      }
    }

    parts.push(findingParts.join('\n'));
  }

  // 5. Previous agent outputs
  if (ctx.structuredOutputs && ctx.structuredOutputs.length > 0) {
    for (const so of ctx.structuredOutputs) {
      const soParts = [`\n[${so.agentName} Output Summary]`, so.summary];
      if (so.structuredData) {
        soParts.push(JSON.stringify(so.structuredData, null, 2));
      }
      parts.push(soParts.join('\n'));
    }
  } else {
    for (const [agentName, output] of ctx.previousOutputs) {
      parts.push(`\n[${agentName} Output]\n${output}`);
    }
  }

  // 6. Reviewer feedback (for Developer re-run)
  if (ctx.reviewFeedback) {
    parts.push(`\n[Reviewer Feedback]\nPlease address the following issues:\n${ctx.reviewFeedback}`);
  }

  // 6.5. Designer feedback (for Designer re-run)
  if (ctx.designerFeedback) {
    parts.push(`\n[Developer Feedback]\nThe developer encountered issues implementing the spec. Please revise:\n${ctx.designerFeedback}`);
  }

  // 7. Git diff (for Reviewer)
  if (ctx.gitDiff) {
    parts.push(`\n[Code Changes (git diff)]\n${ctx.gitDiff}`);
  }

  // 8. Screen frames (for visual analysis agents: Product Designer, UX Planner)
  if (ctx.screenFrames && ctx.screenFrames.length > 0) {
    const frameList = ctx.screenFrames
      .map((f, i) => `${i + 1}. ${f}`)
      .join('\n');
    parts.push(
      `\n[앱 화면 캡처]\n다음 이미지 파일들은 앱의 현재 상태를 순서대로 캡처한 것입니다.\n각 이미지를 Read 도구로 확인하여 UI/UX를 분석하세요:\n${frameList}`,
    );
  }

  // (QA mode override removed — qa_engineer agent has been deleted in favor of smoke_tester.)

  return parts.join('\n\n');
}
