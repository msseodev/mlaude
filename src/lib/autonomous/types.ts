// --- Status types ---
export type AutoSessionStatus = 'running' | 'paused' | 'waiting_for_limit' | 'completed' | 'stopped';
export type AutoCycleStatus = 'running' | 'completed' | 'failed' | 'rate_limited' | 'rolled_back';
export type AutoPhase = 'discovery' | 'fix' | 'test' | 'improve' | 'review' | 'pipeline';
export type FindingCategory = 'bug' | 'improvement' | 'idea' | 'test_failure' | 'performance' | 'accessibility' | 'security';
export type FindingPriority = 'P0' | 'P1' | 'P2' | 'P3';
export type FindingStatus = 'open' | 'in_progress' | 'resolved' | 'wont_fix' | 'duplicate';
export type AgentRunStatus = 'running' | 'completed' | 'failed' | 'skipped';
export type PipelineType = 'discovery' | 'fix' | 'test_fix';
export type CEORequestType = 'permission' | 'resource' | 'decision' | 'information';
export type CEORequestStatus = 'pending' | 'approved' | 'rejected' | 'answered';

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
  build_passed: number | null;       // SQLite 0/1
  lint_passed: number | null;        // SQLite 0/1
  composite_score: number | null;    // 0~100
  score_breakdown: string | null;    // JSON string of CycleScore
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
  project_path?: string | null;
  resolution_summary?: string | null;
  epic_id?: string | null;
  epic_order?: number | null;
  prd_path?: string | null;
  created_at: string;
  updated_at: string;
}

export interface FailureHistoryEntry {
  cycle_id: string;
  approach: string;
  failure_reason: string;
  timestamp: string;
  screenshots?: string[];
}

export interface AutoAgent {
  id: string;
  name: string;
  display_name: string;
  role_description: string;
  system_prompt: string;
  model: string;
  pipeline_order: number;
  parallel_group: string | null;  // Agents with same non-null group run in parallel
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
  exit_code: number | null;
  started_at: string;
  completed_at: string | null;
}

export interface CEORequest {
  id: string;
  session_id: string;
  cycle_id: string | null;
  from_agent: string;
  type: CEORequestType;
  title: string;
  description: string;
  metadata: string | null;   // JSON blob for structured data (e.g., deferred finding blueprint)
  blocking: number;          // SQLite 0/1
  status: CEORequestStatus;
  ceo_response: string | null;
  created_at: string;
  responded_at: string | null;
}

export interface AutoSettings {
  target_project: string;
  test_command: string;
  build_command: string;     // default: '' (empty = skip)
  lint_command: string;      // default: '' (empty = skip)
  max_cycles: number;        // 0 = unlimited
  auto_commit: boolean;
  branch_name: string;
  max_retries: number;       // per finding
  max_consecutive_failures: number;
  review_max_iterations: number;
  skip_designer_for_fixes: boolean;
  require_initial_prompt: boolean;
  max_designer_iterations: number;
  screenshot_dir: string;        // default: '' (auto-detect)
  global_prompt: string;         // default: '' (injected into all agents)
  parallel_mode: boolean;           // default: false
  max_parallel_pipelines: number;   // default: 3
  memory_enabled: boolean;              // default: true
  knowledge_extraction_interval: number; // default: 5 (cycles)
  max_knowledge_context_chars: number;   // default: 3500
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
  | 'tool_input'
  | 'tool_result'
  | 'tool_end'
  | 'rate_limit'
  | 'session_status'
  | 'agent_start'
  | 'agent_complete'
  | 'agent_failed'
  | 'review_iteration'
  | 'user_prompt_added'
  | 'parallel_group_start'
  | 'parallel_group_complete'
  | 'planning_review_start'
  | 'planning_dev_review'
  | 'ceo_request_created'
  | 'ceo_request_responded'
  | 'parallel_batch_start'
  | 'parallel_batch_complete'
  | 'auth_expired'
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
  epic_id?: string | null;
  epic_order?: number | null;
  prd_path?: string | null;
}

// --- Memory system types ---
export type TeamMessageCategory = 'convention' | 'architecture' | 'warning' | 'limitation' | 'pattern';

export interface TeamMessage {
  id: string;
  project_path: string;
  session_id: string | null;
  cycle_id: string | null;
  from_agent: string;
  category: TeamMessageCategory;
  content: string;
  created_at: string;
}

export type KnowledgeCategory = 'architecture_decision' | 'coding_convention' | 'known_limitation' | 'resolved_pattern';

export interface KnowledgeEntry {
  id: string;
  project_path: string;
  category: KnowledgeCategory;
  title: string;
  content: string;
  source_session_id: string | null;
  source_agent: string | null;
  occurrence_count: number;
  last_seen_at: string;
  created_at: string;
  superseded_by: string | null;
}
