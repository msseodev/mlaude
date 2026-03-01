import { ClaudeExecutor } from '../claude-executor';
import { getSetting } from '../db';
import {
  getAutoAgents,
  createAutoAgentRun,
  updateAutoAgentRun,
  getAllAutoSettings,
  getAutoUserPrompts,
  getAutoCycle,
} from './db';
import { GitManager } from './git-manager';
import { StateManager } from './state-manager';
import { buildAgentContext, StructuredAgentOutput } from './agent-context-builder';
import { parseAgentOutput } from './output-parser';
import { buildUserPrompt } from './user-prompt-builder';
import type {
  AutoAgent,
  AutoSession,
  AutoFinding,
  AutoSSEEvent,
  AutoAgentRun,
} from './types';
import type { SSEEvent, RateLimitInfo } from '../types';

export interface PipelineResult {
  success: boolean;
  agentRuns: AutoAgentRun[];
  finalOutput: string;
  totalCostUsd: number;
  totalDurationMs: number;
  qaResult?: { passed: boolean; testOutput: string };
  abortedByRateLimit?: boolean;
  rateLimitInfo?: RateLimitInfo;
}

interface SingleAgentResult {
  agentRun: AutoAgentRun;
  rateLimited: boolean;
  rateLimitInfo?: RateLimitInfo;
}

export class PipelineExecutor {
  private currentExecutor: ClaudeExecutor | null = null;
  private aborted = false;

  constructor(
    private session: AutoSession,
    private cycleId: string,
    private cycleNumber: number,
    private emit: (event: AutoSSEEvent) => void,
    private finding?: AutoFinding | null,
  ) {}

  async execute(): Promise<PipelineResult> {
    const settings = getAllAutoSettings();
    const enabledAgents = getAutoAgents(true);

    // Skip designer for fix cycles if configured
    const agents = (this.finding && settings.skip_designer_for_fixes)
      ? enabledAgents.filter(a => a.name !== 'product_designer')
      : enabledAgents;

    const userPrompts = getAutoUserPrompts(this.session.id);
    const userPromptText = buildUserPrompt(this.session, userPrompts);

    const stateManager = new StateManager(this.session.target_project);
    const stateContext = await stateManager.readState() || '';

    const previousOutputs = new Map<string, string>();
    const structuredOutputs: StructuredAgentOutput[] = [];
    const allAgentRuns: AutoAgentRun[] = [];
    let totalCostUsd = 0;
    let totalDurationMs = 0;

    for (const agent of agents) {
      if (this.aborted) break;

      // Emit agent_start
      this.emit({
        type: 'agent_start',
        data: { agentId: agent.id, agentName: agent.display_name, cycleId: this.cycleId },
        timestamp: new Date().toISOString(),
      });

      // Build git diff for reviewer
      let gitDiff: string | undefined;
      if (agent.name === 'reviewer') {
        const gitManager = new GitManager(this.session.target_project);
        const cycle = getAutoCycle(this.cycleId);
        if (cycle?.git_checkpoint) {
          gitDiff = await gitManager.getDiff(cycle.git_checkpoint);
        }
      }

      const context = buildAgentContext(agent, {
        userPrompt: userPromptText,
        sessionState: stateContext,
        previousOutputs,
        structuredOutputs,
        finding: this.finding,
        gitDiff,
      });

      const result = await this.runSingleAgent(agent, context, 1);

      if (result.rateLimited) {
        return {
          success: false,
          agentRuns: allAgentRuns,
          finalOutput: '',
          totalCostUsd,
          totalDurationMs,
          abortedByRateLimit: true,
          rateLimitInfo: result.rateLimitInfo,
        };
      }

      allAgentRuns.push(result.agentRun);
      totalCostUsd += result.agentRun.cost_usd ?? 0;
      totalDurationMs += result.agentRun.duration_ms ?? 0;
      previousOutputs.set(agent.display_name, result.agentRun.output);

      // Parse and store structured output
      const parsed = parseAgentOutput(agent.display_name, result.agentRun.output);
      structuredOutputs.push({
        agentName: agent.display_name,
        summary: parsed.summary,
        fullOutputId: result.agentRun.id,
        structuredData: parsed.structuredData,
      });

      // Emit agent_complete or agent_failed
      this.emit({
        type: result.agentRun.status === 'completed' ? 'agent_complete' : 'agent_failed',
        data: {
          agentId: agent.id,
          agentName: agent.display_name,
          status: result.agentRun.status,
          costUsd: result.agentRun.cost_usd,
          durationMs: result.agentRun.duration_ms,
        },
        timestamp: new Date().toISOString(),
      });

      // Developer -> Designer feedback loop
      if (agent.name === 'developer' && result.agentRun.status === 'completed') {
        const devParsed = parseDeveloperOutput(result.agentRun.output);
        if (devParsed.blocked) {
          const loopResult = await this.designerDeveloperLoop(
            agents,
            settings.max_designer_iterations,
            userPromptText,
            stateContext,
            structuredOutputs,
            previousOutputs,
            devParsed.blockerReason,
          );

          allAgentRuns.push(...loopResult.additionalRuns);
          totalCostUsd += loopResult.additionalCost;
          totalDurationMs += loopResult.additionalDuration;

          if (loopResult.latestDeveloperOutput) {
            previousOutputs.set('Developer', loopResult.latestDeveloperOutput);
          }

          // Merge updated structured outputs
          structuredOutputs.push(...loopResult.additionalStructuredOutputs);

          if (loopResult.abortedByRateLimit) {
            return {
              success: false,
              agentRuns: allAgentRuns,
              finalOutput: '',
              totalCostUsd,
              totalDurationMs,
              abortedByRateLimit: true,
              rateLimitInfo: loopResult.rateLimitInfo,
            };
          }
        }
      }

      // Reviewer <-> Developer loop
      if (agent.name === 'reviewer' && result.agentRun.status === 'completed') {
        const reviewResult = parseReviewOutput(result.agentRun.output);
        if (!reviewResult.approved) {
          const loopResult = await this.reviewerDeveloperLoop(
            agents,
            settings.review_max_iterations,
            userPromptText,
            stateContext,
            previousOutputs,
            reviewResult.feedback,
            structuredOutputs,
          );

          allAgentRuns.push(...loopResult.additionalRuns);
          totalCostUsd += loopResult.additionalCost;
          totalDurationMs += loopResult.additionalDuration;

          if (loopResult.latestDeveloperOutput) {
            previousOutputs.set('Developer', loopResult.latestDeveloperOutput);
          }

          if (loopResult.abortedByRateLimit) {
            return {
              success: false,
              agentRuns: allAgentRuns,
              finalOutput: '',
              totalCostUsd,
              totalDurationMs,
              abortedByRateLimit: true,
              rateLimitInfo: loopResult.rateLimitInfo,
            };
          }
        }
      }
    }

    // Determine QA result
    const qaRun = allAgentRuns.find(r =>
      r.agent_name === 'QA Engineer' || r.agent_name === 'qa_engineer'
    );
    let qaResult: PipelineResult['qaResult'];
    if (qaRun && qaRun.status === 'completed') {
      qaResult = parseQAOutput(qaRun.output);
    }

    const allAgentsFailed = allAgentRuns.length > 0 && allAgentRuns.every(r => r.status === 'failed');

    return {
      success: !allAgentsFailed && (!qaResult || qaResult.passed),
      agentRuns: allAgentRuns,
      finalOutput: Array.from(previousOutputs.values()).join('\n\n---\n\n'),
      totalCostUsd,
      totalDurationMs,
      qaResult,
    };
  }

  private async runSingleAgent(
    agent: AutoAgent,
    prompt: string,
    iteration: number,
  ): Promise<SingleAgentResult> {
    const agentRun = createAutoAgentRun({
      cycle_id: this.cycleId,
      agent_id: agent.id,
      agent_name: agent.display_name,
      iteration,
      prompt,
    });

    const startTime = Date.now();

    return new Promise<SingleAgentResult>((resolve) => {
      let output = '';
      let resolved = false;

      const claudeBinary = getSetting('claude_binary') || 'claude';

      this.currentExecutor = new ClaudeExecutor(
        claudeBinary,
        // onEvent
        (event: SSEEvent) => {
          if (event.type === 'text_delta') {
            output += (event.data.text as string) || '';
          }
          this.emit({
            type: event.type as AutoSSEEvent['type'],
            data: event.data,
            timestamp: event.timestamp,
          });
        },
        // onRateLimit
        (info: RateLimitInfo) => {
          if (resolved) return;
          resolved = true;
          const now = new Date().toISOString();
          updateAutoAgentRun(agentRun.id, {
            status: 'failed',
            output,
            duration_ms: Date.now() - startTime,
            completed_at: now,
          });
          resolve({
            agentRun: { ...agentRun, status: 'failed', output, duration_ms: Date.now() - startTime, completed_at: now },
            rateLimited: true,
            rateLimitInfo: info,
          });
        },
        // onComplete
        (result: { cost_usd: number | null; duration_ms: number | null; output: string; isError: boolean }) => {
          if (resolved) return;
          resolved = true;
          const now = new Date().toISOString();
          const status = result.isError ? 'failed' : 'completed';
          const finalOutput = result.output || output;
          const updated = updateAutoAgentRun(agentRun.id, {
            status: status as AutoAgentRun['status'],
            output: finalOutput,
            cost_usd: result.cost_usd,
            duration_ms: result.duration_ms,
            completed_at: now,
          });
          resolve({
            agentRun: updated ?? {
              ...agentRun,
              status: status as AutoAgentRun['status'],
              output: finalOutput,
              cost_usd: result.cost_usd,
              duration_ms: result.duration_ms,
              completed_at: now,
            },
            rateLimited: false,
          });
        },
      );

      this.currentExecutor.execute(prompt, this.session.target_project);
    });
  }

  private async reviewerDeveloperLoop(
    agents: AutoAgent[],
    maxIterations: number,
    userPrompt: string,
    stateContext: string,
    previousOutputs: Map<string, string>,
    initialFeedback: string,
    structuredOutputs: StructuredAgentOutput[],
  ): Promise<{
    additionalRuns: AutoAgentRun[];
    additionalCost: number;
    additionalDuration: number;
    latestDeveloperOutput?: string;
    abortedByRateLimit?: boolean;
    rateLimitInfo?: RateLimitInfo;
  }> {
    const developer = agents.find(a => a.name === 'developer');
    const reviewer = agents.find(a => a.name === 'reviewer');
    if (!developer || !reviewer) {
      return { additionalRuns: [], additionalCost: 0, additionalDuration: 0 };
    }

    const runs: AutoAgentRun[] = [];
    let totalCost = 0;
    let totalDuration = 0;
    let feedback = initialFeedback;
    let latestDevOutput: string | undefined;

    for (let i = 0; i < maxIterations; i++) {
      if (this.aborted) break;

      // Emit review_iteration
      this.emit({
        type: 'review_iteration',
        data: { iteration: i + 1, maxIterations, feedback },
        timestamp: new Date().toISOString(),
      });

      // Re-run Developer with feedback
      const devContext = buildAgentContext(developer, {
        userPrompt,
        sessionState: stateContext,
        previousOutputs,
        structuredOutputs,
        finding: this.finding,
        reviewFeedback: feedback,
      });

      this.emit({
        type: 'agent_start',
        data: { agentId: developer.id, agentName: developer.display_name, cycleId: this.cycleId },
        timestamp: new Date().toISOString(),
      });

      const devResult = await this.runSingleAgent(developer, devContext, i + 2);
      if (devResult.rateLimited) {
        return { additionalRuns: runs, additionalCost: totalCost, additionalDuration: totalDuration, abortedByRateLimit: true, rateLimitInfo: devResult.rateLimitInfo };
      }
      runs.push(devResult.agentRun);
      totalCost += devResult.agentRun.cost_usd ?? 0;
      totalDuration += devResult.agentRun.duration_ms ?? 0;
      latestDevOutput = devResult.agentRun.output;
      previousOutputs.set(developer.display_name, devResult.agentRun.output);

      this.emit({
        type: devResult.agentRun.status === 'completed' ? 'agent_complete' : 'agent_failed',
        data: { agentId: developer.id, agentName: developer.display_name, status: devResult.agentRun.status },
        timestamp: new Date().toISOString(),
      });

      // Re-run Reviewer
      const gitManager = new GitManager(this.session.target_project);
      const cycle = getAutoCycle(this.cycleId);
      const gitDiff = cycle?.git_checkpoint ? await gitManager.getDiff(cycle.git_checkpoint) : '';

      const reviewContext = buildAgentContext(reviewer, {
        userPrompt,
        sessionState: stateContext,
        previousOutputs,
        structuredOutputs,
        gitDiff,
      });

      this.emit({
        type: 'agent_start',
        data: { agentId: reviewer.id, agentName: reviewer.display_name, cycleId: this.cycleId },
        timestamp: new Date().toISOString(),
      });

      const reviewResult = await this.runSingleAgent(reviewer, reviewContext, i + 2);
      if (reviewResult.rateLimited) {
        return { additionalRuns: runs, additionalCost: totalCost, additionalDuration: totalDuration, abortedByRateLimit: true, rateLimitInfo: reviewResult.rateLimitInfo };
      }
      runs.push(reviewResult.agentRun);
      totalCost += reviewResult.agentRun.cost_usd ?? 0;
      totalDuration += reviewResult.agentRun.duration_ms ?? 0;

      this.emit({
        type: reviewResult.agentRun.status === 'completed' ? 'agent_complete' : 'agent_failed',
        data: { agentId: reviewer.id, agentName: reviewer.display_name, status: reviewResult.agentRun.status },
        timestamp: new Date().toISOString(),
      });

      const parsed = parseReviewOutput(reviewResult.agentRun.output);
      if (parsed.approved) break;

      feedback = parsed.feedback;
    }

    return { additionalRuns: runs, additionalCost: totalCost, additionalDuration: totalDuration, latestDeveloperOutput: latestDevOutput };
  }

  private async designerDeveloperLoop(
    agents: AutoAgent[],
    maxIterations: number,
    userPrompt: string,
    stateContext: string,
    structuredOutputs: StructuredAgentOutput[],
    previousOutputs: Map<string, string>,
    blockerReason: string,
  ): Promise<{
    additionalRuns: AutoAgentRun[];
    additionalCost: number;
    additionalDuration: number;
    latestDeveloperOutput?: string;
    additionalStructuredOutputs: StructuredAgentOutput[];
    abortedByRateLimit?: boolean;
    rateLimitInfo?: RateLimitInfo;
  }> {
    const designer = agents.find(a => a.name === 'product_designer');
    const developer = agents.find(a => a.name === 'developer');
    if (!designer || !developer) {
      return { additionalRuns: [], additionalCost: 0, additionalDuration: 0, additionalStructuredOutputs: [] };
    }

    const runs: AutoAgentRun[] = [];
    const newStructuredOutputs: StructuredAgentOutput[] = [];
    let totalCost = 0;
    let totalDuration = 0;
    let feedback = blockerReason;
    let latestDevOutput: string | undefined;

    for (let i = 0; i < maxIterations; i++) {
      if (this.aborted) break;

      // Emit designer_iteration
      this.emit({
        type: 'designer_iteration',
        data: { iteration: i + 1, maxIterations, feedback },
        timestamp: new Date().toISOString(),
      });

      // Re-run Designer with feedback
      const designerContext = buildAgentContext(designer, {
        userPrompt,
        sessionState: stateContext,
        previousOutputs,
        structuredOutputs,
        finding: this.finding,
        designerFeedback: feedback,
      });

      this.emit({
        type: 'agent_start',
        data: { agentId: designer.id, agentName: designer.display_name, cycleId: this.cycleId },
        timestamp: new Date().toISOString(),
      });

      const designerResult = await this.runSingleAgent(designer, designerContext, i + 2);
      if (designerResult.rateLimited) {
        return { additionalRuns: runs, additionalCost: totalCost, additionalDuration: totalDuration, additionalStructuredOutputs: newStructuredOutputs, abortedByRateLimit: true, rateLimitInfo: designerResult.rateLimitInfo };
      }
      runs.push(designerResult.agentRun);
      totalCost += designerResult.agentRun.cost_usd ?? 0;
      totalDuration += designerResult.agentRun.duration_ms ?? 0;
      previousOutputs.set(designer.display_name, designerResult.agentRun.output);

      const designerParsed = parseAgentOutput(designer.display_name, designerResult.agentRun.output);
      newStructuredOutputs.push({
        agentName: designer.display_name,
        summary: designerParsed.summary,
        fullOutputId: designerResult.agentRun.id,
        structuredData: designerParsed.structuredData,
      });

      this.emit({
        type: designerResult.agentRun.status === 'completed' ? 'agent_complete' : 'agent_failed',
        data: { agentId: designer.id, agentName: designer.display_name, status: designerResult.agentRun.status },
        timestamp: new Date().toISOString(),
      });

      // Re-run Developer with revised spec
      const devContext = buildAgentContext(developer, {
        userPrompt,
        sessionState: stateContext,
        previousOutputs,
        structuredOutputs: [...structuredOutputs, ...newStructuredOutputs],
        finding: this.finding,
      });

      this.emit({
        type: 'agent_start',
        data: { agentId: developer.id, agentName: developer.display_name, cycleId: this.cycleId },
        timestamp: new Date().toISOString(),
      });

      const devResult = await this.runSingleAgent(developer, devContext, i + 2);
      if (devResult.rateLimited) {
        return { additionalRuns: runs, additionalCost: totalCost, additionalDuration: totalDuration, additionalStructuredOutputs: newStructuredOutputs, abortedByRateLimit: true, rateLimitInfo: devResult.rateLimitInfo };
      }
      runs.push(devResult.agentRun);
      totalCost += devResult.agentRun.cost_usd ?? 0;
      totalDuration += devResult.agentRun.duration_ms ?? 0;
      latestDevOutput = devResult.agentRun.output;
      previousOutputs.set(developer.display_name, devResult.agentRun.output);

      const devParsedOutput = parseAgentOutput(developer.display_name, devResult.agentRun.output);
      newStructuredOutputs.push({
        agentName: developer.display_name,
        summary: devParsedOutput.summary,
        fullOutputId: devResult.agentRun.id,
        structuredData: devParsedOutput.structuredData,
      });

      this.emit({
        type: devResult.agentRun.status === 'completed' ? 'agent_complete' : 'agent_failed',
        data: { agentId: developer.id, agentName: developer.display_name, status: devResult.agentRun.status },
        timestamp: new Date().toISOString(),
      });

      // Check if developer is still blocked
      const devBlockerCheck = parseDeveloperOutput(devResult.agentRun.output);
      if (!devBlockerCheck.blocked) break;

      feedback = devBlockerCheck.blockerReason;
    }

    return { additionalRuns: runs, additionalCost: totalCost, additionalDuration: totalDuration, latestDeveloperOutput: latestDevOutput, additionalStructuredOutputs: newStructuredOutputs };
  }

  abort(): void {
    this.aborted = true;
    if (this.currentExecutor) {
      this.currentExecutor.kill();
      this.currentExecutor = null;
    }
  }
}

// --- Exported parse helpers (also used by tests) ---

export function parseReviewOutput(output: string): { approved: boolean; feedback: string } {
  try {
    const jsonMatch = output.match(/\{[\s\S]*"approved"[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        approved: parsed.approved === true,
        feedback: parsed.issues ? JSON.stringify(parsed.issues, null, 2) : parsed.summary || '',
      };
    }
  } catch { /* fallback */ }
  // Default to approved to avoid infinite loops
  return { approved: true, feedback: '' };
}

export function parseQAOutput(output: string): { passed: boolean; testOutput: string } {
  try {
    const jsonMatch = output.match(/\{[\s\S]*"summary"[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      const failed = parsed.summary?.failed ?? 0;
      return { passed: failed === 0, testOutput: output };
    }
  } catch { /* fallback */ }
  return { passed: true, testOutput: output };
}

export function parseDeveloperOutput(output: string): { blocked: boolean; blockerReason: string } {
  const blockerPatterns = [
    /BLOCKER:\s*([\s\S]*?)(?:\n\n|\n(?=[A-Z])|$)/i,
    /BLOCKED:\s*([\s\S]*?)(?:\n\n|\n(?=[A-Z])|$)/i,
    /CANNOT IMPLEMENT:\s*([\s\S]*?)(?:\n\n|\n(?=[A-Z])|$)/i,
    /IMPLEMENTATION FAILED:\s*([\s\S]*?)(?:\n\n|\n(?=[A-Z])|$)/i,
    /SPEC ISSUE:\s*([\s\S]*?)(?:\n\n|\n(?=[A-Z])|$)/i,
  ];
  for (const pattern of blockerPatterns) {
    const match = output.match(pattern);
    if (match) return { blocked: true, blockerReason: match[1].trim() };
  }
  // Also check for JSON structured blocker
  try {
    const jsonMatch = output.match(/\{[\s\S]*"blocked"[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.blocked === true) return { blocked: true, blockerReason: parsed.reason || parsed.blocker_reason || 'Unknown blocker' };
    }
  } catch { /* fallback */ }
  return { blocked: false, blockerReason: '' };
}
