// --- Status types ---
export type AutoSessionStatus = 'running' | 'paused' | 'waiting_for_limit' | 'completed' | 'stopped';
export type AutoCycleStatus = 'running' | 'completed' | 'failed' | 'rate_limited' | 'rolled_back';
export type AutoPhase = 'discovery' | 'fix' | 'test' | 'improve' | 'review' | 'pipeline';
export type FindingCategory = 'bug' | 'improvement' | 'idea' | 'test_failure' | 'performance' | 'accessibility' | 'security';
export type FindingPriority = 'P0' | 'P1' | 'P2' | 'P3';
export type FindingStatus = 'open' | 'in_progress' | 'resolved' | 'wont_fix' | 'duplicate';
export type AgentRunStatus = 'running' | 'completed' | 'failed' | 'skipped';

// --- DB Entities ---
export interface AutoSession {
  id: string;
  target_project: string;
  status: AutoSessionStatus;
  total_cycles: number;
  total_cost_usd: number;
  config: string | null;   // JSON string of session config
  initial_prompt?: string | null;
  created_at: string;
  updated_at: string;
}

export interface AutoCycle {
  id: string;
  session_id: string;
  cycle_number: number;
  phase: AutoPhase;
  status: AutoCycleStatus;
  finding_id: string | null;
  prompt_used: string | null;
  output: string;
  cost_usd: number | null;
  duration_ms: number | null;
  git_checkpoint: string | null;
  test_pass_count: number | null;
  test_fail_count: number | null;
  test_total_count: number | null;
  started_at: string;
  completed_at: string | null;
}

export interface AutoFinding {
  id: string;
  session_id: string;
  category: FindingCategory;
  priority: FindingPriority;
  title: string;
  description: string;
  file_path: string | null;
  status: FindingStatus;
  retry_count: number;
  max_retries: number;
  resolved_by_cycle_id: string | null;
  failure_history: string | null;
  created_at: string;
  updated_at: string;
}

export interface FailureHistoryEntry {
  cycle_id: string;
  approach: string;
  failure_reason: string;
  timestamp: string;
}

export interface AutoAgent {
  id: string;
  name: string;
  display_name: string;
  role_description: string;
  system_prompt: string;
  pipeline_order: number;
  enabled: number;       // SQLite integer 0/1
  is_builtin: number;    // SQLite integer 0/1
  created_at: string;
  updated_at: string;
}

export interface AutoUserPrompt {
  id: string;
  session_id: string;
  content: string;
  added_at_cycle: number;
  active_for_cycles: number | null;  // null = permanent
  created_at: string;
}

export interface AutoAgentRun {
  id: string;
  cycle_id: string;
  agent_id: string;
  agent_name: string;
  iteration: number;
  status: AgentRunStatus;
  prompt: string;
  output: string;
  cost_usd: number | null;
  duration_ms: number | null;
  started_at: string;
  completed_at: string | null;
}

export interface AutoSettings {
  target_project: string;
  test_command: string;
  max_cycles: number;        // 0 = unlimited
  budget_usd: number;        // 0 = unlimited
  discovery_interval: number; // every N cycles
  review_interval: number;    // every N cycles
  auto_commit: boolean;
  branch_name: string;
  max_retries: number;       // per finding
  max_consecutive_failures: number;
  review_max_iterations: number;
  skip_designer_for_fixes: boolean;
  require_initial_prompt: boolean;
  max_designer_iterations: number;
}

// --- SSE Event types ---
export type AutoSSEEventType =
  | 'cycle_start'
  | 'cycle_complete'
  | 'cycle_failed'
  | 'phase_change'
  | 'finding_created'
  | 'finding_resolved'
  | 'finding_failed'
  | 'test_result'
  | 'git_checkpoint'
  | 'git_rollback'
  | 'designer_iteration'
  | 'text_delta'
  | 'tool_start'
  | 'tool_end'
  | 'rate_limit'
  | 'session_status'
  | 'agent_start'
  | 'agent_complete'
  | 'agent_failed'
  | 'review_iteration'
  | 'user_prompt_added'
  | 'error';

export interface AutoSSEEvent {
  type: AutoSSEEventType;
  data: Record<string, unknown>;
  timestamp: string;
}

// --- Status response for UI polling ---
export interface AutoRunStatus {
  sessionId: string | null;
  status: AutoSessionStatus | 'idle';
  currentCycle: number;
  currentPhase: AutoPhase | null;
  currentFinding: { id: string; title: string } | null;
  stats: {
    totalCycles: number;
    totalCostUsd: number;
    findingsTotal: number;
    findingsResolved: number;
    findingsOpen: number;
    testPassRate: number | null;
  };
  currentAgent: { id: string; name: string } | null;
  pipelineAgents: Array<{ id: string; name: string; status: string }>;
  waitingUntil: string | null;
  retryCount: number;
  pauseAfterCycle: boolean;
}

// --- Test result ---
export interface TestResult {
  passed: boolean;
  output: string;
  exitCode: number | null;
  duration_ms: number;
  passCount: number | null;
  failCount: number | null;
  totalCount: number | null;
}

// --- Extracted finding from Claude output ---
export interface ExtractedFinding {
  category: FindingCategory;
  priority: FindingPriority;
  title: string;
  description: string;
  file_path: string | null;
}
