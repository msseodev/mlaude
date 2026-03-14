import { runClaudeOneShot } from './summarizer';
import { getAutoCyclesBySession, getAutoAgents, updateAutoAgent, getAutoAgentRunsByCycle } from './db';
import { createPromptVariant, getActiveVariant, updatePromptVariant, getVariantHistory } from './evolution-db';
import type { AutoSettings, AutoSSEEvent, AutoCycle, PromptVariant } from './types';
import type { CycleScore } from './cycle-scorer';

// Called every evolution_interval cycles
export async function checkAndEvolve(
  sessionId: string,
  currentCycleNumber: number,
  settings: AutoSettings,
  claudeBinary: string,
  emit: (event: AutoSSEEvent) => void,
): Promise<void> {
  emit({ type: 'evolution_started', data: { cycleNumber: currentCycleNumber }, timestamp: new Date().toISOString() });

  const agents = getAutoAgents(true); // enabled only

  for (const agent of agents) {
    // 1. Check if there's an evaluating variant that needs judgment
    const activeVariant = getActiveVariant(agent.id);
    const evaluatingVariants = getVariantHistory(agent.id).filter(v => v.status === 'evaluating');

    if (evaluatingVariants.length > 0) {
      // There's a variant being evaluated - check if enough cycles passed
      const variant = evaluatingVariants[0];
      if (variant.cycles_evaluated >= settings.evolution_window) {
        const result = shouldRollback(variant, activeVariant ?? null);
        if (!result.keepActive) {
          // Rollback: restore previous prompt
          if (activeVariant) {
            updateAutoAgent(agent.id, { system_prompt: activeVariant.system_prompt });
          }
          updatePromptVariant(variant.id, { status: 'retired' });
          emit({ type: 'prompt_rollback', data: { agentId: agent.id, agentName: agent.display_name, reason: result.reason }, timestamp: new Date().toISOString() });
        } else {
          // Keep: promote evaluating to active, retire previous
          updatePromptVariant(variant.id, { status: 'active' });
          if (activeVariant) {
            updatePromptVariant(activeVariant.id, { status: 'retired' });
          }
        }
      }
      continue; // Don't start a new evolution while evaluating
    }

    // 2. Evaluate current performance
    const cycles = getAutoCyclesBySession(sessionId)
      .filter(c => c.status === 'completed' && c.composite_score != null);

    const recentCycles = cycles.slice(-settings.evolution_window);
    const olderCycles = cycles.slice(0, -settings.evolution_window);

    // Filter to cycles where this agent participated
    const agentRecentCycles = recentCycles
      .filter(c => {
        const runs = getAutoAgentRunsByCycle(c.id);
        return runs.some(r => r.agent_id === agent.id);
      });

    const recentScores = agentRecentCycles.map(c => c.composite_score!);

    const olderScores = olderCycles
      .filter(c => {
        const runs = getAutoAgentRunsByCycle(c.id);
        return runs.some(r => r.agent_id === agent.id);
      })
      .map(c => c.composite_score!);

    const { shouldEvolve, reason, currentAvgScore } = evaluateAgentPerformance(
      agent.id, recentScores, olderScores, settings.evolution_window
    );

    if (!shouldEvolve) continue;

    // 3. Generate mutated prompt
    const performanceContext = buildPerformanceContext(recentScores, olderScores, settings.evolution_window, agentRecentCycles);
    const mutatedPrompt = await generateMutatedPrompt(claudeBinary, agent.system_prompt, performanceContext);

    if (!mutatedPrompt || mutatedPrompt === agent.system_prompt) continue;

    // 4. Save current as active variant (if not already tracked)
    if (!activeVariant) {
      const newVariant = createPromptVariant({
        agent_id: agent.id,
        system_prompt: agent.system_prompt,
        generation: 0,
        status: 'active',
      });
      updatePromptVariant(newVariant.id, { avg_score: currentAvgScore, cycles_evaluated: settings.evolution_window });
    }

    // 5. Create evaluating variant
    createPromptVariant({
      agent_id: agent.id,
      system_prompt: mutatedPrompt,
      parent_variant_id: activeVariant?.id ?? null,
      generation: (activeVariant?.generation ?? 0) + 1,
      status: 'evaluating',
    });

    // 6. Apply to agent
    updateAutoAgent(agent.id, { system_prompt: mutatedPrompt });

    emit({ type: 'prompt_mutated', data: { agentId: agent.id, agentName: agent.display_name, reason, avgScore: currentAvgScore }, timestamp: new Date().toISOString() });
  }

  emit({ type: 'evolution_completed', data: { cycleNumber: currentCycleNumber }, timestamp: new Date().toISOString() });
}

/* eslint-disable @typescript-eslint/no-unused-vars */
// Pure function: evaluates agent performance over recent cycles
export function evaluateAgentPerformance(
  _agentId: string,
  recentScores: number[],
  olderScores: number[],
  _windowSize: number,
): { shouldEvolve: boolean; reason: string; currentAvgScore: number } {
/* eslint-enable @typescript-eslint/no-unused-vars */
  if (recentScores.length < 3) {
    return { shouldEvolve: false, reason: 'Insufficient data', currentAvgScore: 0 };
  }

  const currentAvg = recentScores.reduce((sum, s) => sum + s, 0) / recentScores.length;

  // Absolute floor
  if (currentAvg < 40) {
    return { shouldEvolve: true, reason: `Score ${currentAvg.toFixed(1)} below absolute floor (40)`, currentAvgScore: currentAvg };
  }

  // Compare with baseline
  if (olderScores.length >= 3) {
    const baselineAvg = olderScores.reduce((sum, s) => sum + s, 0) / olderScores.length;
    if (baselineAvg > 0 && currentAvg < baselineAvg * 0.9) {
      return { shouldEvolve: true, reason: `Score dropped from ${baselineAvg.toFixed(1)} to ${currentAvg.toFixed(1)} (>${10}% decline)`, currentAvgScore: currentAvg };
    }
  }

  return { shouldEvolve: false, reason: 'Performance acceptable', currentAvgScore: currentAvg };
}

// Pure function: decide whether to keep the new variant or rollback
export function shouldRollback(
  evaluatingVariant: PromptVariant,
  previousVariant: PromptVariant | null,
): { keepActive: boolean; reason: string } {
  if (evaluatingVariant.cycles_evaluated < 3) {
    return { keepActive: true, reason: 'Not enough evaluation cycles yet' };
  }

  const previousScore = previousVariant?.avg_score ?? 0;
  const currentScore = evaluatingVariant.avg_score ?? 0;

  if (currentScore >= previousScore) {
    return { keepActive: true, reason: `New variant (${currentScore.toFixed(1)}) >= previous (${previousScore.toFixed(1)})` };
  }

  if (previousScore - currentScore > 5) {
    return { keepActive: false, reason: `New variant worse by ${(previousScore - currentScore).toFixed(1)} points, rolling back` };
  }

  return { keepActive: true, reason: 'Difference within noise margin' };
}

// Build context string describing recent performance issues
function buildPerformanceContext(
  recentScores: number[],
  olderScores: number[],
  windowSize: number,
  recentCycles?: AutoCycle[],
): string {
  const currentAvg = recentScores.length > 0
    ? recentScores.reduce((sum, s) => sum + s, 0) / recentScores.length
    : 0;

  const baselineAvg = olderScores.length > 0
    ? olderScores.reduce((sum, s) => sum + s, 0) / olderScores.length
    : null;

  let context = `Performance (last ${windowSize} cycles):\n`;
  context += `- Average score: ${currentAvg.toFixed(1)}/100\n`;
  if (baselineAvg !== null) {
    context += `- Baseline average: ${baselineAvg.toFixed(1)}/100\n`;
    const decline = ((baselineAvg - currentAvg) / baselineAvg * 100).toFixed(1);
    context += `- Decline: ${decline}%\n`;
  }
  context += `- Recent scores: [${recentScores.map(s => s.toFixed(0)).join(', ')}]\n`;

  // Parse score breakdowns from cycles for detailed failure analysis
  if (recentCycles && recentCycles.length > 0) {
    let buildFailures = 0;
    let testFailures = 0;
    let reviewerRejections = 0;
    const failureReasons: string[] = [];

    for (const cycle of recentCycles) {
      if (!cycle.score_breakdown) continue;
      try {
        const breakdown = JSON.parse(cycle.score_breakdown) as CycleScore;
        if (breakdown.build_passed === false) {
          buildFailures++;
          failureReasons.push(`Cycle ${cycle.cycle_number}: build failed`);
        }
        if (breakdown.test_passed === false) {
          testFailures++;
          failureReasons.push(`Cycle ${cycle.cycle_number}: tests failed (pass rate: ${((breakdown.test_pass_rate ?? 0) * 100).toFixed(0)}%)`);
        }
        if (breakdown.reviewer_approved === false) {
          reviewerRejections++;
          failureReasons.push(`Cycle ${cycle.cycle_number}: reviewer rejected`);
        }
      } catch {
        // Skip unparseable breakdowns
      }
    }

    if (buildFailures > 0 || testFailures > 0 || reviewerRejections > 0) {
      context += `\nFailure summary:\n`;
      if (buildFailures > 0) context += `- Build failures: ${buildFailures}/${recentCycles.length}\n`;
      if (testFailures > 0) context += `- Test failures: ${testFailures}/${recentCycles.length}\n`;
      if (reviewerRejections > 0) context += `- Reviewer rejections: ${reviewerRejections}/${recentCycles.length}\n`;
      context += `\nSpecific failures:\n`;
      for (const reason of failureReasons) {
        context += `- ${reason}\n`;
      }
    }
  }

  return context;
}

// Use LLM to generate a mutated prompt
async function generateMutatedPrompt(
  claudeBinary: string,
  currentPrompt: string,
  performanceContext: string,
): Promise<string> {
  const prompt = `You are improving an AI agent's system prompt based on performance data.

Current prompt:
---
${currentPrompt}
---

${performanceContext}

Requirements:
1. Preserve core role and output format
2. Address identified weaknesses with specific guidance
3. Keep similar length (+/-20%)
4. Do NOT change fundamental purpose

Output ONLY the improved prompt, nothing else.`;

  return runClaudeOneShot(claudeBinary, prompt);
}
