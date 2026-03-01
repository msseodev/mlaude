import { NextRequest, NextResponse } from 'next/server';
import { autoEngine } from '@/lib/autonomous/cycle-engine';

// POST /api/auto — Start autonomous session
export async function POST(request: NextRequest) {
  try {
    let targetProject: string | undefined;
    let initialPrompt: string | undefined;
    try {
      const body = await request.json();
      targetProject = body.targetProject;
      initialPrompt = body.initialPrompt;
    } catch {
      // No body is fine
    }
    await autoEngine.start(targetProject, initialPrompt);
    const status = autoEngine.getStatus();
    return NextResponse.json(status);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to start autonomous mode';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE /api/auto — Stop autonomous session
export async function DELETE() {
  try {
    await autoEngine.stop();
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to stop autonomous mode' }, { status: 500 });
  }
}

// PATCH /api/auto — Pause/Resume
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, midSessionPrompt } = body;
    if (action === 'pause') {
      await autoEngine.pause();
      return NextResponse.json({ success: true });
    } else if (action === 'pause_after_cycle') {
      await autoEngine.pauseAfterCycle();
      return NextResponse.json({ success: true });
    } else if (action === 'cancel_pause_after_cycle') {
      autoEngine.cancelPauseAfterCycle();
      return NextResponse.json({ success: true });
    } else if (action === 'resume') {
      await autoEngine.resume(midSessionPrompt);
      return NextResponse.json({ success: true });
    } else {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update autonomous mode';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
