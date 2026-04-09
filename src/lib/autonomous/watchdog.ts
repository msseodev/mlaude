// Watchdog that periodically checks if the current cycle is stuck
// Spawns a lightweight Claude session to make the kill decision

import { ClaudeExecutor } from '../claude-executor';
import { getSetting } from '../db';

const WATCHDOG_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

export interface WatchdogDiagnostics {
  cycleId: string;
  cycleNumber: number;
  startedAt: string;
  elapsedMs: number;
  currentAgentName: string | null;
  agentStartedAt: string | null;
  lastOutputAt: string | null;
  outputSizeBytes: number;
  outputGrowthSinceLastCheck: number;  // bytes grown since last watchdog check
  findingTitle: string | null;
  sessionTotalCost: number;
  cycleCost: number;
}

export class Watchdog {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastOutputSize: number = 0;
  private getDiagnostics: (() => WatchdogDiagnostics | null) | null = null;
  private onKillDecision: (() => void) | null = null;
  private onEvent: ((message: string) => void) | null = null;

  start(
    getDiagnostics: () => WatchdogDiagnostics | null,
    onKillDecision: () => void,
    onEvent?: (message: string) => void,
  ): void {
    this.stop(); // clear any previous timer
    this.lastOutputSize = 0;
    this.getDiagnostics = getDiagnostics;
    this.onKillDecision = onKillDecision;
    this.onEvent = onEvent ?? null;

    this.timer = setInterval(() => {
      this.check();
    }, WATCHDOG_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.getDiagnostics = null;
    this.onKillDecision = null;
    this.onEvent = null;
    this.lastOutputSize = 0;
  }

  private async check(): Promise<void> {
    if (!this.getDiagnostics || !this.onKillDecision) return;

    const diag = this.getDiagnostics();
    if (!diag) return; // no active cycle

    const outputGrowth = diag.outputSizeBytes - this.lastOutputSize;
    this.lastOutputSize = diag.outputSizeBytes;
    diag.outputGrowthSinceLastCheck = outputGrowth;

    this.onEvent?.(`[watchdog] Checking cycle ${diag.cycleNumber} (elapsed: ${Math.round(diag.elapsedMs / 1000 / 60)}min, output growth: ${outputGrowth} bytes)`);

    try {
      const shouldKill = await this.evaluateWithAgent(diag);
      if (shouldKill) {
        this.onEvent?.(`[watchdog] Kill decision for cycle ${diag.cycleNumber}: agent is stuck`);
        this.onKillDecision();
      } else {
        this.onEvent?.(`[watchdog] Cycle ${diag.cycleNumber} appears healthy, continuing`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown error';
      this.onEvent?.(`[watchdog] Evaluation failed: ${msg}`);
      // On evaluation failure, don't kill - be conservative
    }
  }

  private evaluateWithAgent(diag: WatchdogDiagnostics): Promise<boolean> {
    return new Promise((resolve) => {
      const claudeBinary = getSetting('claude_binary') || 'claude';

      const prompt = `You are a watchdog monitor for an autonomous coding agent. Evaluate whether the current cycle is stuck and should be killed.

## Diagnostics
- Cycle: #${diag.cycleNumber} (ID: ${diag.cycleId})
- Task: ${diag.findingTitle || 'No specific finding'}
- Current Agent: ${diag.currentAgentName || 'unknown'}
- Agent Started: ${diag.startedAt}
- Agent Elapsed: ${Math.round(diag.elapsedMs / 1000 / 60)} minutes
- Last Output: ${diag.lastOutputAt || 'no output yet'}
- Output Size: ${diag.outputSizeBytes} bytes
- Output Growth (last hour): ${diag.outputGrowthSinceLastCheck} bytes
- Cycle Cost: $${diag.cycleCost?.toFixed(2) || '0.00'}
- Session Total Cost: $${diag.sessionTotalCost?.toFixed(2) || '0.00'}

## Decision Criteria
- If output has NOT grown at all in the last hour AND agent elapsed > 60 minutes → likely stuck
- If output is growing (even slowly), the agent may be working → let it continue
- If agent elapsed > 3 hours regardless of output growth → consider killing (diminishing returns)
- If cost for this single cycle > $20 → consider killing (cost overrun)
- Normal cycle costs $3-$20. Cycle 7 (model training on GCP) was an exception at $63.

## Response
Answer with ONLY one of:
- KILL: [reason]
- CONTINUE: [reason]`;

      const executor = new ClaudeExecutor(
        claudeBinary,
        () => {}, // no SSE needed
        () => { resolve(false); }, // on rate limit, don't kill
        (result) => {
          const output = result.output.trim().toUpperCase();
          if (output.startsWith('KILL')) {
            resolve(true);
          } else {
            resolve(false);
          }
        },
      );

      executor.execute(prompt, '/tmp', 'claude-opus-4-6');

      // Safety timeout for the watchdog itself: 2 minutes
      setTimeout(() => {
        executor.kill();
        resolve(false); // if watchdog agent times out, don't kill the main cycle
      }, 2 * 60 * 1000);
    });
  }
}
