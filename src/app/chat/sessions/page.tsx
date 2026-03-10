'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';

interface ChatSessionItem {
  id: string;
  title: string;
  status: string;
  message_count: number;
  total_cost_usd: number;
  created_at: string;
  updated_at: string;
}

export default function ChatSessionsPage() {
  const [sessions, setSessions] = useState<ChatSessionItem[]>([]);
  const router = useRouter();

  const loadSessions = useCallback(async () => {
    try {
      const res = await fetch('/api/chat/sessions');
      if (res.ok) {
        setSessions(await res.json());
      }
    } catch {
      // ignore fetch errors
    }
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const switchToSession = async (sessionId: string) => {
    try {
      await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'switch', sessionId }),
      });
      router.push('/chat');
    } catch {
      // ignore
    }
  };

  const deleteSession = async (sessionId: string) => {
    try {
      await fetch(`/api/chat/sessions/${sessionId}`, { method: 'DELETE' });
      loadSessions();
    } catch {
      // ignore
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString();
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-gray-900">Chat Sessions</h1>
        <Button variant="primary" size="sm" onClick={() => router.push('/chat')}>
          New Chat
        </Button>
      </div>

      {sessions.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <p>No chat sessions yet.</p>
          <p className="text-sm mt-1">Start a new chat to begin.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {sessions.map((session) => (
            <div
              key={session.id}
              className="flex items-center justify-between p-4 bg-white rounded-lg border border-gray-200 hover:border-gray-300 transition-colors"
            >
              <div
                className="flex-1 cursor-pointer"
                onClick={() => switchToSession(session.id)}
              >
                <div className="font-medium text-gray-900">{session.title}</div>
                <div className="text-sm text-gray-500 mt-1 flex gap-4">
                  <span>{session.message_count} messages</span>
                  {session.total_cost_usd > 0 && (
                    <span>${session.total_cost_usd.toFixed(4)}</span>
                  )}
                  <span>{formatDate(session.updated_at)}</span>
                </div>
              </div>
              <Button
                variant="danger"
                size="sm"
                onClick={(e: React.MouseEvent) => {
                  e.stopPropagation();
                  deleteSession(session.id);
                }}
              >
                Delete
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
