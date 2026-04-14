// DB entities
export type PromptStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
export type SessionStatus = 'idle' | 'running' | 'paused' | 'waiting_for_limit' | 'completed' | 'stopped';

export interface Prompt {
  id: string;
  title: string;
  content: string;
  queue_order: number;
  status: PromptStatus;
  working_directory: string | null;
  model: string | null;
  created_at: string;
  updated_at: string;
}

export interface RunSession {
  id: string;
  status: SessionStatus;
  current_prompt_id: string | null;
  plan_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Execution {
  id: string;
  prompt_id: string;
  run_session_id: string;
  status: 'running' | 'completed' | 'failed' | 'rate_limited';
  output: string;
  cost_usd: number | null;
  duration_ms: number | null;
  started_at: string;
  completed_at: string | null;
  prompt_title?: string;
  plan_id?: string | null;
  effective_prompt?: string | null;
}

// Claude CLI stream-json event types
export interface ClaudeSystemEvent {
  type: 'system';
  subtype: string;
  session_id?: string;
  tools?: string[];
  model?: string;
}

export interface ClaudeAssistantEvent {
  type: 'assistant';
  message: {
    id: string;
    type: 'message';
    role: 'assistant';
    content: Array<{type: 'text'; text: string} | {type: 'tool_use'; id: string; name: string; input: Record<string, unknown>}>;
    model: string;
    stop_reason: string | null;
    usage?: { input_tokens: number; output_tokens: number };
  };
  session_id?: string;
}

export interface ClaudeStreamEvent {
  type: 'content_block_start' | 'content_block_delta' | 'content_block_stop';
  index?: number;
  content_block?: { type: string; text?: string; id?: string; name?: string };
  delta?: { type: string; text?: string; partial_json?: string };
}

export interface ClaudeResultEvent {
  type: 'result';
  subtype: string;
  result?: string;
  cost_usd?: number;
  duration_ms?: number;
  duration_api_ms?: number;
  is_error?: boolean;
  session_id?: string;
  total_cost_usd?: number;
}

export type ClaudeEvent = ClaudeSystemEvent | ClaudeAssistantEvent | ClaudeStreamEvent | ClaudeResultEvent | { type: string; [key: string]: unknown };

// SSE events sent to browser
export type SSEEventType =
  | 'text_delta'
  | 'tool_start'
  | 'tool_input'
  | 'tool_result'
  | 'tool_end'
  | 'prompt_start'
  | 'prompt_complete'
  | 'prompt_failed'
  | 'rate_limit'
  | 'rate_limit_wait'
  | 'queue_complete'
  | 'queue_stopped'
  | 'session_status'
  | 'auth_expired'
  | 'error';

export interface SSEEvent {
  type: SSEEventType;
  data: Record<string, unknown>;
  timestamp: string;
}

export interface RateLimitInfo {
  detected: boolean;
  source: 'exit_code' | 'stream_event' | 'text_pattern' | 'pre_flight_check' | null;
  message: string | null;
  retryAfterMs: number | null;
}

export interface RunStatus {
  sessionId: string | null;
  status: SessionStatus;
  currentPromptId: string | null;
  currentPromptTitle: string | null;
  completedCount: number;
  totalCount: number;
  waitingUntil: string | null;
  retryCount: number;
  planId: string | null;
  planName: string | null;
}

export interface Settings {
  working_directory: string;
  claude_binary: string;
  global_prompt: string;
  claude_session_key: string;
  claude_org_id: string;
}

export interface Plan {
  id: string;
  name: string;
  description: string;
  plan_prompt: string;
  created_at: string;
  updated_at: string;
}

export interface PlanItem {
  id: string;
  plan_id: string;
  prompt_id: string;
  item_order: number;
  created_at: string;
  // Joined fields
  prompt_title?: string;
  prompt_content?: string;
  prompt_working_directory?: string | null;
}

export interface PlanItemRun {
  id: string;
  run_session_id: string;
  plan_item_id: string;
  prompt_id: string;
  status: PromptStatus;
  created_at: string;
  updated_at: string;
  // Joined fields
  prompt_title?: string;
  item_order?: number;
}

export interface PlanWithItems extends Plan {
  items: PlanItem[];
}

// ── Chat Mode Types ──

export type ChatSessionStatus = 'idle' | 'active' | 'responding' | 'error';

export interface ChatSession {
  id: string;
  claude_session_id: string; // Claude CLI session ID for --resume
  title: string;
  working_directory: string;
  model: string | null;
  status: ChatSessionStatus;
  total_cost_usd: number;
  message_count: number;
  created_at: string;
  updated_at: string;
}

export interface ChatMessage {
  id: string;
  session_id: string;
  role: 'user' | 'assistant';
  content: string;
  cost_usd: number | null;
  duration_ms: number | null;
  created_at: string;
}

export interface ChatStatus {
  sessionId: string | null;
  claudeSessionId: string | null;
  status: ChatSessionStatus;
  title: string | null;
  workingDirectory: string | null;
  totalCostUsd: number;
  messageCount: number;
}

export type ChatSSEEventType =
  | 'text_delta'
  | 'tool_start'
  | 'tool_input'
  | 'tool_result'
  | 'tool_end'
  | 'message_start'
  | 'message_complete'
  | 'message_failed'
  | 'chat_status'
  | 'error';

export interface ChatSSEEvent {
  type: ChatSSEEventType;
  data: Record<string, unknown>;
  timestamp: string;
}
