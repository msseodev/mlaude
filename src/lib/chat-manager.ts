import { randomUUID } from 'crypto';
import { ChatExecutor } from './chat-executor';
import {
  createChatSession,
  getChatSession,
  getChatSessions,
  updateChatSession,
  deleteChatSession,
  createChatMessage,
  getChatMessages,
  getSetting,
} from './db';
import type { ChatSession, ChatMessage, ChatStatus, ChatSSEEvent } from './types';

type ChatListener = (event: ChatSSEEvent) => void;

class ChatManagerImpl {
  private executor: ChatExecutor | null = null;
  private currentSessionId: string | null = null;
  private listeners: Set<ChatListener> = new Set();
  private eventBuffer: ChatSSEEvent[] = [];
  private static MAX_BUFFER_SIZE = 200;

  // Get the active session status
  getStatus(): ChatStatus {
    if (!this.currentSessionId) {
      return {
        sessionId: null,
        claudeSessionId: null,
        status: 'idle',
        title: null,
        workingDirectory: null,
        totalCostUsd: 0,
        messageCount: 0,
      };
    }

    const session = getChatSession(this.currentSessionId);
    if (!session) {
      this.currentSessionId = null;
      return {
        sessionId: null,
        claudeSessionId: null,
        status: 'idle' as const,
        title: null,
        workingDirectory: null,
        totalCostUsd: 0,
        messageCount: 0,
      };
    }

    return {
      sessionId: session.id,
      claudeSessionId: session.claude_session_id,
      status: session.status as ChatStatus['status'],
      title: session.title,
      workingDirectory: session.working_directory,
      totalCostUsd: session.total_cost_usd,
      messageCount: session.message_count,
    };
  }

  // Create a new chat session
  createSession(workingDirectory?: string, model?: string): ChatSession {
    const id = randomUUID();
    const claudeSessionId = randomUUID();
    const wd = workingDirectory || getSetting('working_directory') || process.cwd();
    const m = model || getSetting('model') || undefined;

    createChatSession(id, claudeSessionId, wd, m);
    this.currentSessionId = id;

    const session = getChatSession(id)!;
    this.emit({ type: 'chat_status', data: this.getStatus() as unknown as Record<string, unknown>, timestamp: new Date().toISOString() });
    return session;
  }

  // Switch to an existing session
  switchSession(sessionId: string): ChatSession | null {
    const session = getChatSession(sessionId);
    if (!session) return null;

    // Stop any running executor
    if (this.executor?.isRunning()) {
      this.executor.kill();
    }

    this.currentSessionId = sessionId;
    this.eventBuffer = [];
    this.emit({ type: 'chat_status', data: this.getStatus() as unknown as Record<string, unknown>, timestamp: new Date().toISOString() });
    return session;
  }

  // Send a message in the current session (auto-creates session if needed)
  async sendMessage(content: string, sessionId?: string): Promise<{ sessionId: string }> {
    let targetSessionId = sessionId || this.currentSessionId;

    // Auto-create session if none exists
    if (!targetSessionId || !getChatSession(targetSessionId)) {
      const newSession = this.createSession();
      targetSessionId = newSession.id;
    }

    const session = getChatSession(targetSessionId)!;

    if (this.executor?.isRunning()) {
      throw new Error('Already responding to a message');
    }

    this.currentSessionId = targetSessionId;

    // Determine if this is the first message BEFORE saving (message_count not yet incremented)
    const isFirstMessage = session.message_count === 0;

    // Save user message
    const userMessageId = randomUUID();
    createChatMessage(userMessageId, targetSessionId, 'user', content);

    // Update session status
    updateChatSession(targetSessionId, { status: 'responding' });

    // Emit message start
    this.emit({
      type: 'message_start',
      data: { sessionId: targetSessionId, userMessage: content, messageId: userMessageId },
      timestamp: new Date().toISOString(),
    });

    const claudeBinary = getSetting('claude_binary') || 'claude';

    const startedAt = Date.now();

    this.executor = new ChatExecutor(
      claudeBinary,
      // onEvent - forward SSE events
      (event) => {
        this.emit(event);
      },
      // onComplete
      (result) => {
        const durationMs = Date.now() - startedAt;
        const assistantMessageId = randomUUID();
        const output = result.output || '(no response)';

        // Save assistant message
        createChatMessage(
          assistantMessageId,
          targetSessionId,
          'assistant',
          output,
          result.cost_usd ?? undefined,
          result.duration_ms ?? durationMs
        );

        if (result.isError) {
          updateChatSession(targetSessionId, { status: 'error' });
          this.emit({
            type: 'message_failed',
            data: {
              sessionId: targetSessionId,
              messageId: assistantMessageId,
              error: output,
              cost_usd: result.cost_usd,
              duration_ms: result.duration_ms ?? durationMs,
            },
            timestamp: new Date().toISOString(),
          });
        } else {
          updateChatSession(targetSessionId, {
            status: 'active',
          });

          // Auto-generate title from first exchange
          if (isFirstMessage && session.title === 'New Chat') {
            const autoTitle = content.slice(0, 50) + (content.length > 50 ? '...' : '');
            updateChatSession(targetSessionId, { title: autoTitle });
          }

          this.emit({
            type: 'message_complete',
            data: {
              sessionId: targetSessionId,
              messageId: assistantMessageId,
              content: output,
              cost_usd: result.cost_usd,
              duration_ms: result.duration_ms ?? durationMs,
            },
            timestamp: new Date().toISOString(),
          });
        }

        this.emit({
          type: 'chat_status',
          data: this.getStatus() as unknown as Record<string, unknown>,
          timestamp: new Date().toISOString(),
        });

        this.executor = null;
      }
    );

    // Build system prompt for chat mode
    const globalPrompt = getSetting('global_prompt') || '';
    const systemPrompt = [
      'You are a helpful assistant chatting via Discord/Web. Answer questions clearly and concisely.',
      'You can read files and search the codebase to answer questions about the project.',
      'If asked to modify code, explain what changes are needed but note that you cannot edit files in chat mode.',
      globalPrompt,
    ].filter(Boolean).join('\n');

    this.executor.execute(content, session.working_directory, {
      claudeSessionId: isFirstMessage ? undefined : session.claude_session_id,
      newSessionId: isFirstMessage ? session.claude_session_id : undefined,
      model: session.model || undefined,
      systemPrompt: isFirstMessage ? systemPrompt : undefined,
    });

    return { sessionId: targetSessionId };
  }

  // Stop current response
  stopResponse(): void {
    if (this.executor?.isRunning()) {
      this.executor.kill();
      this.executor = null;
    }
    if (this.currentSessionId) {
      updateChatSession(this.currentSessionId, { status: 'active' });
      this.emit({
        type: 'chat_status',
        data: this.getStatus() as unknown as Record<string, unknown>,
        timestamp: new Date().toISOString(),
      });
    }
  }

  // Delete a session
  removeSession(sessionId: string): void {
    if (this.currentSessionId === sessionId) {
      this.stopResponse();
      this.currentSessionId = null;
    }
    deleteChatSession(sessionId);
    this.emit({
      type: 'chat_status',
      data: this.getStatus() as unknown as Record<string, unknown>,
      timestamp: new Date().toISOString(),
    });
  }

  // Get all sessions
  getSessions(): ChatSession[] {
    return getChatSessions();
  }

  // Get messages for a session
  getMessages(sessionId: string, limit = 100, offset = 0): ChatMessage[] {
    return getChatMessages(sessionId, limit, offset);
  }

  // SSE listener management
  addListener(listener: ChatListener): () => void {
    this.listeners.add(listener);

    // Send buffered events to new listener
    for (const event of this.eventBuffer) {
      try {
        listener(event);
      } catch {
        // Ignore errors in catch-up
      }
    }

    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(event: ChatSSEEvent): void {
    // Buffer the event
    this.eventBuffer.push(event);
    if (this.eventBuffer.length > ChatManagerImpl.MAX_BUFFER_SIZE) {
      this.eventBuffer = this.eventBuffer.slice(-ChatManagerImpl.MAX_BUFFER_SIZE);
    }

    // Notify all listeners
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Ignore listener errors
      }
    }
  }
}

// HMR-safe singleton
const GLOBAL_KEY = '__mlaude_chat_manager__';

function getChatManager(): ChatManagerImpl {
  const g = globalThis as unknown as Record<string, ChatManagerImpl>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new ChatManagerImpl();
  }
  return g[GLOBAL_KEY];
}

export const chatManager = getChatManager();
