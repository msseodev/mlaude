import { NextRequest, NextResponse } from 'next/server';
import { chatManager } from '@/lib/chat-manager';

// POST /api/chat - Send a message or create a new session
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, message, sessionId, workingDirectory, model } = body;

    if (action === 'create') {
      const session = chatManager.createSession(workingDirectory, model);
      return NextResponse.json(session);
    }

    if (action === 'send' || (!action && message)) {
      if (!message) {
        return NextResponse.json({ error: 'Message is required' }, { status: 400 });
      }
      const result = await chatManager.sendMessage(message, sessionId);
      return NextResponse.json({ ok: true, sessionId: result.sessionId });
    }

    if (action === 'switch') {
      if (!sessionId) {
        return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
      }
      const session = chatManager.switchSession(sessionId);
      if (!session) {
        return NextResponse.json({ error: 'Session not found' }, { status: 404 });
      }
      return NextResponse.json(session);
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE /api/chat - Stop response or delete session
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get('sessionId');

    if (sessionId) {
      chatManager.removeSession(sessionId);
      return NextResponse.json({ ok: true });
    }

    // Stop current response
    chatManager.stopResponse();
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
