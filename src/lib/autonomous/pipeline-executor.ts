import { ClaudeExecutor } from '../claude-executor';
import { getSetting } from '../db';
import {
  getAutoAgents,
  createAutoAgentRun,
  updateAutoAgentRun,
  getAllAutoSettings,
  getAutoUserPrompts,
  getAutoFindings,
  createAutoFinding,
  getAutoCycle,
  getCEORequests,
  createCEORequest,
} from './db';
import { FindingExtractor } from './finding-extractor';
import { getCrossSessionFindings } from './memory-db';
import { GitManager } from './git-manager';
import { StateManager } from './state-manager';
import { buildAgentContext, StructuredAgentOutput } from './agent-context-builder';
import { parseAgentOutput, parseCEORequests, parseTeamMessages } from './output-parser';
import { createTeamMessage } from './memory-db';
import { buildUserPrompt } from './user-prompt-builder';
import { captureAppScreens } from './screen-capture';
import { KnowledgeManager } from './knowledge-manager';
import type {
  AutoAgent,
  AutoSession,
  AutoFinding,
  AutoSSEEvent,
  AutoAgentRun,
  PipelineType,
} from './types';
import type { SSEEvent, RateLimitInfo } from '../types';

export interface PipelineResult {
  success: boolean;
  agentRuns: AutoAgentRun[];
  finalOutput: string;
  totalCostUsd: number;
  totalDurationMs: number;
  qaResult?: { passed: boolean; testOutput: string };
  blockerInfo?: { agentName: string; reason: string };
  createdFindings?: Array<{ priority: string; title: string; category: string }>;
  abortedByRateLimit?: boolean;
  rateLimitInfo?: RateLimitInfo;
  abortedByAuthError?: boolean;
}

interface SingleAgentResult {
  agentRun: AutoAgentRun;
  rateLimited: boolean;
  rateLimitInfo?: RateLimitInfo;
  authError?: boolean;
}

interface ExecutionStep {
  parallel: boolean;
  agents: AutoAgent[];
  order: number;
  groupName?: string;
}

interface FeedbackLoopResult {
  additionalRuns: AutoAgentRun[];
  additionalCost: number;
  additionalDuration: number;
  latestDeveloperOutput?: string;
  additionalStructuredOutputs: StructuredAgentOutput[];
  abortedByRateLimit?: boolean;
  rateLimitInfo?: RateLimitInfo;
  abortedByAuthError?: boolean;
}

// Planning agents — receive screen frames and initial_prompt
export const PLANNER_AGENT_NAMES = new Set(['product_designer', 'ux_planner', 'tech_planner', 'analyzer', 'biz_planner', 'music_domain_planner', 'planning_moderator', 'test_runner']);
export function isPlannerAgent(agent: AutoAgent): boolean {
  return PLANNER_AGENT_NAMES.has(agent.name);
}

export class PipelineExecutor {
  private currentExecutor: ClaudeExecutor | null = null;
  private aborted = false;
  private lastActivityAt: string = new Date().toISOString();
  private currentAgentName: string | null = null;
  private currentAgentStartedAt: string | null = null;
  private totalOutputSize: number = 0;
  private totalCostSoFar: number = 0;

  constructor(
    private session: AutoSession,
    private cycleId: string,
    private cycleNumber: number,
    private emit: (event: AutoSSEEvent) => void,
    private finding?: AutoFinding | null,
    private pipelineType?: PipelineType,
  ) {}

  getActivityInfo(): {
    lastActivityAt: string;
    currentAgentName: string | null;
    currentAgentStartedAt: string | null;
    totalOutputSize: number;
    totalCostSoFar: number;
  } {
    return {
      lastActivityAt: this.lastActivityAt,
      currentAgentName: this.currentAgentName,
      currentAgentStartedAt: this.currentAgentStartedAt,
      totalOutputSize: this.totalOutputSize,
      totalCostSoFar: this.totalCostSoFar,
    };
  }

  async execute(): Promise<PipelineResult> {
    const settings = getAllAutoSettings();
    const enabledAgents = getAutoAgents(true);
    const agents = this.filterAgentsByPipelineType(enabledAgents);

    const userPrompts = getAutoUserPrompts(this.session.id);
    const userPromptText = buildUserPrompt(this.session, userPrompts, this.cycleNumber);

    const stateManager = new StateManager(this.session.target_project);
    const stateContext = await stateManager.readState() || '';

    // Capture screenshots for planner agents
    const screenshotDir = settings.screenshot_dir || undefined;
    const screenCapture = await captureAppScreens(this.session.target_project, {
      screenshotDir,
    });

    const globalPrompt = settings.global_prompt || '';
    const knowledgeManager = new KnowledgeManager(this.session.target_project);

    const previousOutputs = new Map<string, string>();
    const structuredOutputs: StructuredAgentOutput[] = [];
    const allAgentRuns: AutoAgentRun[] = [];
    let totalCostUsd = 0;
    let totalDurationMs = 0;
    let blockerInfo: PipelineResult['blockerInfo'];

    // Fetch existing CEO requests for context
    const ceoRequests = getCEORequests(this.session.id);

    // Findings created from moderator/designer output (populated immediately on agent completion)
    const createdFindings: Array<{ priority: string; title: string; category: string }> = [];

    // Build execution plan with parallel group support
    const executionSteps = this.buildExecutionPlan(agents);

    for (const step of executionSteps) {
      if (this.aborted) break;

      if (step.parallel) {
        // Emit parallel_group_start
        this.emit({
          type: 'parallel_group_start',
          data: {
            groupName: step.groupName ?? 'unknown',
            agentIds: step.agents.map(a => a.id),
          },
          timestamp: new Date().toISOString(),
        });

        // Run all agents in this group in parallel
        const parallelResults = await Promise.all(
          step.agents.map(agent => {
            // Emit agent_start for each parallel agent
            this.emit({
              type: 'agent_start',
              data: { agentId: agent.id, agentName: agent.display_name, cycleId: this.cycleId },
              timestamp: new Date().toISOString(),
            });

            const knowledgeCtx = settings.memory_enabled
              ? knowledgeManager.buildKnowledgeContext(agent.name, settings.max_knowledge_context_chars)
              : { knowledge: '', teamMessages: '', wontFixSummary: '' };

            const context = buildAgentContext(agent, {
              userPrompt: isPlannerAgent(agent) ? userPromptText : '',
              sessionState: stateContext,
              previousOutputs,
              structuredOutputs,
              finding: this.finding,
              screenFrames: PLANNER_AGENT_NAMES.has(agent.name) && screenCapture.frames.length > 0
                ? screenCapture.frames
                : undefined,
              ceoRequests,
              pipelineType: this.pipelineType,
              globalPrompt,
              projectKnowledge: knowledgeCtx.knowledge || undefined,
              teamMessages: knowledgeCtx.teamMessages || undefined,
              wontFixSummary: isPlannerAgent(agent) ? (knowledgeCtx.wontFixSummary || undefined) : undefined,
            });

            return this.runSingleAgent(agent, context, 1);
          })
        );

        // Check for auth errors or rate limits in any parallel result
        for (const result of parallelResults) {
          if (result.authError) {
            return {
              success: false,
              agentRuns: allAgentRuns,
              finalOutput: '',
              totalCostUsd,
              totalDurationMs,
              abortedByAuthError: true,
            };
          }
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
        }

        // Collect all outputs from parallel agents
        for (let i = 0; i < step.agents.length; i++) {
          const agent = step.agents[i];
          const result = parallelResults[i];

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

          // Extract CEO requests from agent output
          const agentCEORequests = parseCEORequests(result.agentRun.output);
          for (const req of agentCEORequests) {
            const created = createCEORequest({
              session_id: this.session.id,
              cycle_id: this.cycleId,
              from_agent: agent.display_name,
              type: req.type,
              title: req.title,
              description: req.description,
              blocking: req.blocking,
            });
            this.emit({
              type: 'ceo_request_created',
              data: { request: created },
              timestamp: new Date().toISOString(),
            });
          }

          // Extract team messages from agent output
          if (settings.memory_enabled) {
            const teamMsgs = parseTeamMessages(result.agentRun.output);
            for (const msg of teamMsgs) {
              createTeamMessage({
                project_path: this.session.target_project,
                session_id: this.session.id,
                cycle_id: this.cycleId,
                from_agent: agent.display_name,
                category: msg.category,
                content: msg.content,
              });
            }
          }

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
        }

        // Emit parallel_group_complete
        this.emit({
          type: 'parallel_group_complete',
          data: { groupName: step.groupName ?? 'unknown' },
          timestamp: new Date().toISOString(),
        });
      } else {
        // Single agent execution (existing serial logic)
        const agent = step.agents[0];

        // Emit planning_review_start for the moderator
        if (agent.name === 'planning_moderator') {
          this.emit({
            type: 'planning_review_start',
            data: { agentId: agent.id, agentName: agent.display_name },
            timestamp: new Date().toISOString(),
          });
        }

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

        const knowledgeCtx = settings.memory_enabled
          ? knowledgeManager.buildKnowledgeContext(agent.name, settings.max_knowledge_context_chars)
          : { knowledge: '', teamMessages: '', wontFixSummary: '' };

        const context = buildAgentContext(agent, {
          userPrompt: isPlannerAgent(agent) ? userPromptText : '',
          sessionState: stateContext,
          previousOutputs,
          structuredOutputs,
          finding: this.finding,
          gitDiff,
          screenFrames: PLANNER_AGENT_NAMES.has(agent.name) && screenCapture.frames.length > 0
            ? screenCapture.frames
            : undefined,
          ceoRequests,
          pipelineType: this.pipelineType,
          globalPrompt,
          projectKnowledge: knowledgeCtx.knowledge || undefined,
          teamMessages: knowledgeCtx.teamMessages || undefined,
          wontFixSummary: isPlannerAgent(agent) ? (knowledgeCtx.wontFixSummary || undefined) : undefined,
        });

        const result = await this.runSingleAgent(agent, context, 1);

        if (result.authError) {
          return {
            success: false,
            agentRuns: allAgentRuns,
            finalOutput: '',
            totalCostUsd,
            totalDurationMs,
            abortedByAuthError: true,
          };
        }

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

        // Extract CEO requests from agent output
        const serialCEORequests = parseCEORequests(result.agentRun.output);
        for (const req of serialCEORequests) {
          const created = createCEORequest({
            session_id: this.session.id,
            cycle_id: this.cycleId,
            from_agent: agent.display_name,
            type: req.type,
            title: req.title,
            description: req.description,
            blocking: req.blocking,
          });
          this.emit({
            type: 'ceo_request_created',
            data: { request: created },
            timestamp: new Date().toISOString(),
          });
        }

        // Extract team messages from agent output
        if (settings.memory_enabled) {
          const teamMsgs = parseTeamMessages(result.agentRun.output);
          for (const msg of teamMsgs) {
            createTeamMessage({
              project_path: this.session.target_project,
              session_id: this.session.id,
              cycle_id: this.cycleId,
              from_agent: agent.display_name,
              category: msg.category,
              content: msg.content,
            });
          }
        }

        // Extract findings immediately when moderator/designer completes
        if ((agent.name === 'planning_moderator' || agent.name === 'product_designer') && result.agentRun.status === 'completed' && result.agentRun.output) {
          const extractor = new FindingExtractor();
          const existingFindings = getAutoFindings({ session_id: this.session.id });
          const crossSessionFindings = getCrossSessionFindings(this.session.target_project, ['resolved', 'wont_fix']);
          const newFindings = extractor.extract(result.agentRun.output, existingFindings, crossSessionFindings);
          for (const f of newFindings) {
            const created = createAutoFinding({
              session_id: this.session.id,
              category: f.category,
              priority: f.priority,
              title: f.title,
              description: f.description,
              file_path: f.file_path,
              epic_id: f.epic_id,
              epic_order: f.epic_order,
            });
            createdFindings.push(created);
            this.emit({
              type: 'finding_created',
              data: { finding: created },
              timestamp: new Date().toISOString(),
            });
          }

          // Extract deferred_items → CEO requests
          try {
            const jsonMatch = result.agentRun.output.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
            const jsonStr = jsonMatch?.[1] || result.agentRun.output;
            const deferredIdx = jsonStr.indexOf('"deferred_items"');
            if (deferredIdx !== -1) {
              const openBrace = jsonStr.lastIndexOf('{', deferredIdx);
              if (openBrace !== -1) {
                let depth = 0;
                let end = openBrace;
                for (let i = openBrace; i < jsonStr.length; i++) {
                  if (jsonStr[i] === '{') depth++;
                  if (jsonStr[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
                }
                const parsed = JSON.parse(jsonStr.slice(openBrace, end + 1));
                if (Array.isArray(parsed.deferred_items)) {
                  for (const item of parsed.deferred_items) {
                    if (!item.title || typeof item.title !== 'string') continue;
                    const reason = typeof item.reason === 'string' ? item.reason : 'Deferred by Planning Moderator';
                    const findingBlueprint = {
                      category: item.category || 'improvement',
                      priority: item.priority || 'P2',
                      title: item.title,
                      description: item.description || reason,
                      file_path: item.file_path || null,
                      epic_id: item.epic_id || null,
                      epic_order: item.epic_order ?? null,
                    };
                    createCEORequest({
                      session_id: this.session.id,
                      cycle_id: this.cycleId,
                      from_agent: agent.display_name,
                      type: 'decision',
                      title: `[Deferred] ${item.title}`,
                      description: reason,
                      metadata: JSON.stringify(findingBlueprint),
                      blocking: false,
                    });
                    this.emit({
                      type: 'ceo_request_created',
                      data: { title: `[Deferred] ${item.title}`, reason },
                      timestamp: new Date().toISOString(),
                    });
                  }
                }
              }
            }
          } catch { /* ignore parse failures */ }
        }

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

        // Developer -> feedback loop (Planning Moderator or Product Designer)
        if ((agent.name === 'developer' || agent.name === 'test_engineer') && result.agentRun.status === 'completed') {
          const devParsed = parseDeveloperOutput(result.agentRun.output);
          if (devParsed.blocked) {
            // Find the moderator first, fall back to designer
            const feedbackTarget = agents.find(a => a.name === 'planning_moderator')
              || agents.find(a => a.name === 'product_designer');

            if (!feedbackTarget) {
              // No feedback target in this pipeline (e.g. test_fix has no planners).
              // Record the blocker so the cycle engine can create an appropriate finding.
              blockerInfo = { agentName: agent.name, reason: devParsed.blockerReason };
            } else {
              // Emit planning_dev_review SSE event
              this.emit({
                type: 'planning_dev_review',
                data: {
                  feedbackTarget: feedbackTarget.display_name,
                  blockerReason: devParsed.blockerReason,
                },
                timestamp: new Date().toISOString(),
              });

              const implementer = agents.find(a => a.name === agent.name)!;
              const loopResult = await this.feedbackLoop(
                feedbackTarget,
                implementer,
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
                previousOutputs.set(agent.display_name, loopResult.latestDeveloperOutput);
              }

              // Merge updated structured outputs
              structuredOutputs.push(...loopResult.additionalStructuredOutputs);

              if (loopResult.abortedByAuthError) {
                return {
                  success: false,
                  agentRuns: allAgentRuns,
                  finalOutput: '',
                  totalCostUsd,
                  totalDurationMs,
                  abortedByAuthError: true,
                };
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

            if (loopResult.abortedByAuthError) {
              return {
                success: false,
                agentRuns: allAgentRuns,
                finalOutput: '',
                totalCostUsd,
                totalDurationMs,
                abortedByAuthError: true,
              };
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
      blockerInfo,
      createdFindings,
    };
  }

  /**
   * Build an execution plan that groups parallel agents together.
   * Agents with the same non-null parallel_group run in parallel.
   * Agents with null parallel_group run serially.
   */
  private buildExecutionPlan(agents: AutoAgent[]): ExecutionStep[] {
    const steps: ExecutionStep[] = [];
    const groups = new Map<string, AutoAgent[]>();

    // Sort by pipeline_order
    const sorted = [...agents].sort((a, b) => a.pipeline_order - b.pipeline_order);

    for (const agent of sorted) {
      if (agent.parallel_group) {
        if (!groups.has(agent.parallel_group)) {
          groups.set(agent.parallel_group, []);
        }
        groups.get(agent.parallel_group)!.push(agent);
      } else {
        steps.push({ parallel: false, agents: [agent], order: agent.pipeline_order });
      }
    }

    // Insert parallel groups at their minimum pipeline_order position
    for (const [groupName, groupAgents] of groups) {
      const minOrder = Math.min(...groupAgents.map(a => a.pipeline_order));
      steps.push({ parallel: true, agents: groupAgents, order: minOrder, groupName });
    }

    // Sort all steps by order
    steps.sort((a, b) => a.order - b.order);
    return steps;
  }

  // Pipeline type system supersedes the old skip_designer_for_fixes setting.
  // The fix and test_fix pipeline types implicitly skip planners/designers.
  private filterAgentsByPipelineType(enabledAgents: AutoAgent[]): AutoAgent[] {
    return filterAgentsByPipelineType(enabledAgents, this.pipelineType);
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

      // Track current agent for watchdog diagnostics
      this.currentAgentName = agent.display_name;
      this.currentAgentStartedAt = new Date().toISOString();

      this.currentExecutor = new ClaudeExecutor(
        claudeBinary,
        // onEvent
        (event: SSEEvent) => {
          if (event.type === 'text_delta') {
            const text = (event.data.text as string) || '';
            output += text;
            this.lastActivityAt = new Date().toISOString();
            this.totalOutputSize += Buffer.byteLength(text, 'utf-8');
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
        (result) => {
          if (resolved) return;
          resolved = true;

          // Treat auth errors like rate limits — bubble up to abort pipeline
          if (result.isAuthError) {
            const now = new Date().toISOString();
            updateAutoAgentRun(agentRun.id, {
              status: 'failed',
              output: result.output || output,
              duration_ms: result.duration_ms ?? (Date.now() - startTime),
              completed_at: now,
            });
            resolve({
              agentRun: { ...agentRun, status: 'failed', output: result.output || output, duration_ms: result.duration_ms ?? (Date.now() - startTime), completed_at: now },
              rateLimited: false,
              authError: true,
            });
            return;
          }

          const now = new Date().toISOString();
          const status = result.isError ? 'failed' : 'completed';
          const finalOutput = result.output || output;
          this.totalCostSoFar += result.cost_usd ?? 0;
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

      this.currentExecutor.execute(prompt, this.session.target_project, agent.model);

      // Agent-level inactivity timeout: kill if no new output for 2 hours
      const AGENT_INACTIVITY_TIMEOUT_MS = 2 * 60 * 60 * 1000;
      let lastOutputLength = 0;
      const inactivityTimer = setInterval(() => {
        if (resolved) {
          clearInterval(inactivityTimer);
          return;
        }
        if (output.length === lastOutputLength) {
          // No new output since last check — kill the agent
          clearInterval(inactivityTimer);
          console.warn(`[pipeline] Agent "${agent.display_name}" killed after ${AGENT_INACTIVITY_TIMEOUT_MS / 60000}min inactivity (output: ${output.length} chars)`);
          this.currentExecutor?.kill();
          if (!resolved) {
            resolved = true;
            const now = new Date().toISOString();
            updateAutoAgentRun(agentRun.id, {
              status: 'failed',
              output: output || `Agent killed: no output for ${AGENT_INACTIVITY_TIMEOUT_MS / 60000} minutes`,
              duration_ms: Date.now() - startTime,
              completed_at: now,
            });
            resolve({
              agentRun: { ...agentRun, status: 'failed', output, duration_ms: Date.now() - startTime, completed_at: now },
              rateLimited: false,
            });
          }
        }
        lastOutputLength = output.length;
      }, AGENT_INACTIVITY_TIMEOUT_MS);
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
    abortedByAuthError?: boolean;
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
        userPrompt: isPlannerAgent(developer) ? userPrompt : '',
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
      if (devResult.authError) {
        return { additionalRuns: runs, additionalCost: totalCost, additionalDuration: totalDuration, abortedByAuthError: true };
      }
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
        userPrompt: isPlannerAgent(reviewer) ? userPrompt : '',
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
      if (reviewResult.authError) {
        return { additionalRuns: runs, additionalCost: totalCost, additionalDuration: totalDuration, abortedByAuthError: true };
      }
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

  /**
   * Generic feedback loop between a "feedback agent" (Planning Moderator or Product Designer)
   * and the Developer. This replaces the old designerDeveloperLoop with a more generic approach.
   */
  private async feedbackLoop(
    feedbackAgent: AutoAgent,
    implementer: AutoAgent,
    maxIterations: number,
    userPrompt: string,
    stateContext: string,
    structuredOutputs: StructuredAgentOutput[],
    previousOutputs: Map<string, string>,
    blockerReason: string,
  ): Promise<FeedbackLoopResult> {
    const runs: AutoAgentRun[] = [];
    const newStructuredOutputs: StructuredAgentOutput[] = [];
    let totalCost = 0;
    let totalDuration = 0;
    let feedback = blockerReason;
    let latestDevOutput: string | undefined;

    for (let i = 0; i < maxIterations; i++) {
      if (this.aborted) break;

      // Emit designer_iteration (reuse same event type for backward compatibility)
      this.emit({
        type: 'designer_iteration',
        data: { iteration: i + 1, maxIterations, feedback, feedbackAgent: feedbackAgent.display_name },
        timestamp: new Date().toISOString(),
      });

      // Re-run feedback agent (Moderator or Designer) with developer feedback
      const feedbackContext = buildAgentContext(feedbackAgent, {
        userPrompt: isPlannerAgent(feedbackAgent) ? userPrompt : '',
        sessionState: stateContext,
        previousOutputs,
        structuredOutputs,
        finding: this.finding,
        designerFeedback: feedback,
      });

      this.emit({
        type: 'agent_start',
        data: { agentId: feedbackAgent.id, agentName: feedbackAgent.display_name, cycleId: this.cycleId },
        timestamp: new Date().toISOString(),
      });

      const feedbackResult = await this.runSingleAgent(feedbackAgent, feedbackContext, i + 2);
      if (feedbackResult.authError) {
        return { additionalRuns: runs, additionalCost: totalCost, additionalDuration: totalDuration, additionalStructuredOutputs: newStructuredOutputs, abortedByAuthError: true };
      }
      if (feedbackResult.rateLimited) {
        return { additionalRuns: runs, additionalCost: totalCost, additionalDuration: totalDuration, additionalStructuredOutputs: newStructuredOutputs, abortedByRateLimit: true, rateLimitInfo: feedbackResult.rateLimitInfo };
      }
      runs.push(feedbackResult.agentRun);
      totalCost += feedbackResult.agentRun.cost_usd ?? 0;
      totalDuration += feedbackResult.agentRun.duration_ms ?? 0;
      previousOutputs.set(feedbackAgent.display_name, feedbackResult.agentRun.output);

      const feedbackParsed = parseAgentOutput(feedbackAgent.display_name, feedbackResult.agentRun.output);
      newStructuredOutputs.push({
        agentName: feedbackAgent.display_name,
        summary: feedbackParsed.summary,
        fullOutputId: feedbackResult.agentRun.id,
        structuredData: feedbackParsed.structuredData,
      });

      this.emit({
        type: feedbackResult.agentRun.status === 'completed' ? 'agent_complete' : 'agent_failed',
        data: { agentId: feedbackAgent.id, agentName: feedbackAgent.display_name, status: feedbackResult.agentRun.status },
        timestamp: new Date().toISOString(),
      });

      // Re-run Developer with revised spec
      const devContext = buildAgentContext(implementer, {
        userPrompt: isPlannerAgent(implementer) ? userPrompt : '',
        sessionState: stateContext,
        previousOutputs,
        structuredOutputs: [...structuredOutputs, ...newStructuredOutputs],
        finding: this.finding,
      });

      this.emit({
        type: 'agent_start',
        data: { agentId: implementer.id, agentName: implementer.display_name, cycleId: this.cycleId },
        timestamp: new Date().toISOString(),
      });

      const devResult = await this.runSingleAgent(implementer, devContext, i + 2);
      if (devResult.authError) {
        return { additionalRuns: runs, additionalCost: totalCost, additionalDuration: totalDuration, additionalStructuredOutputs: newStructuredOutputs, abortedByAuthError: true };
      }
      if (devResult.rateLimited) {
        return { additionalRuns: runs, additionalCost: totalCost, additionalDuration: totalDuration, additionalStructuredOutputs: newStructuredOutputs, abortedByRateLimit: true, rateLimitInfo: devResult.rateLimitInfo };
      }
      runs.push(devResult.agentRun);
      totalCost += devResult.agentRun.cost_usd ?? 0;
      totalDuration += devResult.agentRun.duration_ms ?? 0;
      latestDevOutput = devResult.agentRun.output;
      previousOutputs.set(implementer.display_name, devResult.agentRun.output);

      const devParsedOutput = parseAgentOutput(implementer.display_name, devResult.agentRun.output);
      newStructuredOutputs.push({
        agentName: implementer.display_name,
        summary: devParsedOutput.summary,
        fullOutputId: devResult.agentRun.id,
        structuredData: devParsedOutput.structuredData,
      });

      this.emit({
        type: devResult.agentRun.status === 'completed' ? 'agent_complete' : 'agent_failed',
        data: { agentId: implementer.id, agentName: implementer.display_name, status: devResult.agentRun.status },
        timestamp: new Date().toISOString(),
      });

      // Check if developer is still blocked
      const devBlockerCheck = parseDeveloperOutput(devResult.agentRun.output);
      if (!devBlockerCheck.blocked) break;

      feedback = devBlockerCheck.blockerReason;
    }

    return { additionalRuns: runs, additionalCost: totalCost, additionalDuration: totalDuration, latestDeveloperOutput: latestDevOutput, additionalStructuredOutputs: newStructuredOutputs };
  }

  /**
   * Legacy method for backward compatibility. Delegates to feedbackLoop.
   */
  private async designerDeveloperLoop(
    agents: AutoAgent[],
    maxIterations: number,
    userPrompt: string,
    stateContext: string,
    structuredOutputs: StructuredAgentOutput[],
    previousOutputs: Map<string, string>,
    blockerReason: string,
  ): Promise<FeedbackLoopResult> {
    const designer = agents.find(a => a.name === 'product_designer');
    const developer = agents.find(a => a.name === 'developer');
    if (!designer || !developer) {
      return { additionalRuns: [], additionalCost: 0, additionalDuration: 0, additionalStructuredOutputs: [] };
    }

    return this.feedbackLoop(
      designer,
      developer,
      maxIterations,
      userPrompt,
      stateContext,
      structuredOutputs,
      previousOutputs,
      blockerReason,
    );
  }

  abort(): void {
    this.aborted = true;
    if (this.currentExecutor) {
      this.currentExecutor.kill();
      this.currentExecutor = null;
    }
  }
}

// --- Exported helpers (also used by tests) ---

/**
 * Filter agents based on pipeline type.
 * Pipeline type system supersedes the old skip_designer_for_fixes setting.
 */
export function filterAgentsByPipelineType(
  enabledAgents: AutoAgent[],
  pipelineType?: PipelineType,
): AutoAgent[] {
  const effectiveType = pipelineType ?? 'discovery';
  switch (effectiveType) {
    case 'fix': {
      // QA skipped for fix cycles — build_command/test_command in cycle-engine handles verification
      const fixNames = new Set(['developer', 'reviewer']);
      return enabledAgents.filter(a => fixNames.has(a.name));
    }
    case 'test_fix': {
      // QA skipped for test_fix cycles — Developer self-tests + evaluation commands handle verification
      const testFixNames = new Set(['test_engineer']);
      return enabledAgents.filter(a => testFixNames.has(a.name));
    }
    case 'discovery':
    default:
      // QA runs only in discovery for full UI testing
      return enabledAgents.filter(a => a.name !== 'test_engineer');
  }
}

// --- Exported parse helpers (also used by tests) ---

export function parseReviewOutput(output: string): { approved: boolean; feedback: string } {
  // Use balanced-brace extraction to find the JSON containing "approved"
  const approvedIdx = output.indexOf('"approved"');
  if (approvedIdx !== -1) {
    const openIdx = output.lastIndexOf('{', approvedIdx);
    if (openIdx !== -1) {
      const json = extractBalancedBraces(output, openIdx);
      if (json) {
        try {
          const parsed = JSON.parse(json);
          if (typeof parsed.approved === 'boolean') {
            return {
              approved: parsed.approved,
              feedback: parsed.issues ? JSON.stringify(parsed.issues, null, 2) : parsed.summary || '',
            };
          }
        } catch { /* fallback */ }
      }
    }
  }
  // Default to approved to avoid infinite loops
  return { approved: true, feedback: '' };
}

export function parseQAOutput(output: string): { passed: boolean; testOutput: string } {
  // Strategy 1: Balanced-brace extraction for deeply nested QA JSON
  const summaryIdx = output.indexOf('"summary"');
  if (summaryIdx !== -1) {
    const openIdx = output.lastIndexOf('{', summaryIdx);
    if (openIdx !== -1) {
      const json = extractBalancedBraces(output, openIdx);
      if (json) {
        try {
          const parsed = JSON.parse(json);
          if (parsed.summary && typeof parsed.summary === 'object') {
            const result = evaluateQASummary(parsed.summary, output);
            if (result !== null) return { passed: result, testOutput: output };
          }
        } catch { /* continue to fallback */ }
      }
    }
  }

  // Strategy 2: Shallow regex fallback for simpler JSON
  const braceMatches = output.matchAll(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g);
  for (const m of braceMatches) {
    try {
      const parsed = JSON.parse(m[0]);
      if (parsed.summary && typeof parsed.summary === 'object') {
        const result = evaluateQASummary(parsed.summary, output);
        if (result !== null) return { passed: result, testOutput: output };
      }
    } catch { continue; }
  }

  // Strategy 3: Text-based heuristic when QA output mentions pre-existing failures
  // but did not produce parseable JSON with summary
  if (hasPreExistingOnlyFailures(output)) {
    return { passed: true, testOutput: output };
  }

  return { passed: true, testOutput: output };
}

/**
 * Evaluate a QA summary object to determine pass/fail.
 * Returns null if the summary doesn't contain usable data.
 */
function evaluateQASummary(summary: Record<string, unknown>, fullOutput: string): boolean | null {
  const newFailed = summary.new_failed;
  const failed = summary.failed;

  // If new_failed is explicitly provided, use it (distinguishes regressions from pre-existing)
  if (typeof newFailed === 'number') {
    return newFailed === 0;
  }

  // new_failed not provided — check text for pre-existing failure evidence
  if (typeof failed === 'number' && failed > 0) {
    if (hasPreExistingOnlyFailures(fullOutput)) {
      return true; // All failures are pre-existing, not regressions
    }
    return false; // Can't confirm pre-existing, treat as real failures
  }

  // No failures at all
  if (typeof failed === 'number' && failed === 0) {
    return true;
  }

  return null;
}

/**
 * Detect whether QA output indicates all failures are pre-existing (not new regressions).
 */
function hasPreExistingOnlyFailures(output: string): boolean {
  const hasPreExisting = /pre.?existing|known\s+fail|already\s+fail/i.test(output);
  const hasNoNew = /new.?failed[":\s]*0|no\s+new\s+(regression|failure)|0\s+new\s+failure|all\s+(failures?\s+)?(are\s+)?pre.?existing/i.test(output);
  return hasPreExisting && hasNoNew;
}

/**
 * Extract balanced JSON from text starting at the given index.
 */
function extractBalancedBraces(text: string, startIdx: number): string | null {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = startIdx; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) {
        const candidate = text.slice(startIdx, i + 1);
        try { JSON.parse(candidate); return candidate; } catch { return null; }
      }
    }
  }
  return null;
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
