'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useSSE } from '@/hooks/useSSE';
import { Button } from '@/components/ui/Button';
import type { SSEEvent } from '@/types';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  cost_usd?: number | null;
  duration_ms?: number | null;
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isResponding, setIsResponding] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const sendingRef = useRef(false); // Guard against double invocation

  // Auto-scroll to bottom
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingContent, scrollToBottom]);

  // Fetch initial status
  useEffect(() => {
    fetch('/api/chat/status')
      .then(res => res.json())
      .then(status => {
        if (status.sessionId) {
          setSessionId(status.sessionId);
          setIsResponding(status.status === 'responding');
          fetch(`/api/chat/sessions/${status.sessionId}`)
            .then(res => res.json())
            .then(data => {
              if (data.messages) {
                setMessages(data.messages);
              }
            })
            .catch(() => {});
        }
      })
      .catch(() => {});
  }, []);

  // SSE connection
  const handleSSEEvent = useCallback((event: SSEEvent) => {
    const { type, data } = event;
    switch (type) {
      case 'text_delta': {
        const text = data.text as string;
        setStreamingContent(prev => prev + text);
        break;
      }
      default:
        break;
    }

    const eventType = type as string;
    switch (eventType) {
      case 'message_start': {
        setIsResponding(true);
        setStreamingContent('');
        break;
      }
      case 'message_complete': {
        const content = data.content as string;
        const messageId = data.messageId as string;
        setMessages(prev => [...prev, {
          id: messageId,
          role: 'assistant',
          content,
          cost_usd: data.cost_usd as number | null,
          duration_ms: data.duration_ms as number | null,
        }]);
        setStreamingContent('');
        setIsResponding(false);
        sendingRef.current = false;
        break;
      }
      case 'message_failed': {
        const error = data.error as string;
        const messageId = data.messageId as string;
        setMessages(prev => [...prev, {
          id: messageId || `error-${Date.now()}`,
          role: 'assistant',
          content: `Error: ${error}`,
        }]);
        setStreamingContent('');
        setIsResponding(false);
        sendingRef.current = false;
        break;
      }
      case 'chat_status': {
        if (data.sessionId) {
          setSessionId(data.sessionId as string);
        }
        setIsResponding(data.status === 'responding');
        break;
      }
    }
  }, []);

  const { connected } = useSSE(
    '/api/chat/stream',
    handleSSEEvent as unknown as (event: SSEEvent) => void,
  );

  // Send message - single API call, server auto-creates session
  const sendMessage = async () => {
    const trimmed = input.trim();
    if (!trimmed || isResponding || sendingRef.current) return;

    sendingRef.current = true;

    // Add user message to UI immediately
    const tempId = `temp-${Date.now()}`;
    setMessages(prev => [...prev, { id: tempId, role: 'user', content: trimmed }]);
    setInput('');

    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'send', message: trimmed, sessionId }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.sessionId) {
          setSessionId(data.sessionId);
        }
      } else {
        sendingRef.current = false;
      }
    } catch {
      sendingRef.current = false;
    }
  };

  const stopResponse = async () => {
    try {
      await fetch('/api/chat', { method: 'DELETE' });
    } catch {}
    sendingRef.current = false;
  };

  const newChat = async () => {
    if (isResponding) {
      await stopResponse();
    }
    setMessages([]);
    setSessionId(null);
    setStreamingContent('');
    setIsResponding(false);
    sendingRef.current = false;
  };

  // Handle keyboard - check isComposing for Korean IME
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const textarea = e.target;
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-gray-200">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold text-gray-900">Chat</h1>
          {sessionId && (
            <span className="text-sm text-gray-500">Session active</span>
          )}
          {connected && (
            <span className="inline-block w-2 h-2 rounded-full bg-green-500" title="Connected" />
          )}
        </div>
        <div className="flex items-center gap-2">
          {isResponding && (
            <Button variant="danger" size="sm" onClick={stopResponse}>
              Stop
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={newChat}>
            New Chat
          </Button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {messages.length === 0 && !isResponding && (
          <div className="flex flex-col items-center justify-center h-full text-gray-400">
            <svg className="h-12 w-12 mb-4 text-gray-300" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.076-4.076a1.526 1.526 0 011.037-.443 48.282 48.282 0 005.68-.494c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
            </svg>
            <p className="text-lg mb-2">Start a conversation</p>
            <p className="text-sm">Ask questions about your codebase, get explanations, or plan work.</p>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] rounded-lg px-4 py-3 ${
              msg.role === 'user'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-900 border border-gray-200'
            }`}>
              <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed break-words">
                {msg.content}
              </pre>
              {msg.role === 'assistant' && (msg.cost_usd || msg.duration_ms) && (
                <div className="mt-2 pt-2 border-t border-gray-200 text-xs text-gray-400 flex gap-3">
                  {msg.cost_usd != null && <span>${msg.cost_usd.toFixed(4)}</span>}
                  {msg.duration_ms != null && <span>{(msg.duration_ms / 1000).toFixed(1)}s</span>}
                </div>
              )}
            </div>
          </div>
        ))}

        {/* Streaming response */}
        {isResponding && streamingContent && (
          <div className="flex justify-start">
            <div className="max-w-[80%] rounded-lg px-4 py-3 bg-gray-100 text-gray-900 border border-gray-200">
              <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed break-words">
                {streamingContent}
              </pre>
              <div className="mt-1">
                <span className="inline-block w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
              </div>
            </div>
          </div>
        )}

        {/* Typing indicator */}
        {isResponding && !streamingContent && (
          <div className="flex justify-start">
            <div className="rounded-lg px-4 py-3 bg-gray-100 border border-gray-200">
              <div className="flex gap-1">
                <span className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-gray-200 px-6 py-4">
        <div className="flex gap-3 items-end">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleTextareaChange}
            onKeyDown={handleKeyDown}
            placeholder="Type a message... (Enter to send, Shift+Enter for newline)"
            disabled={isResponding}
            rows={1}
            className="flex-1 bg-white text-gray-900 rounded-lg px-4 py-3 resize-none border border-gray-300 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 placeholder-gray-400 disabled:opacity-50 text-sm"
          />
          <Button
            variant="primary"
            onClick={sendMessage}
            disabled={!input.trim() || isResponding}
          >
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}
