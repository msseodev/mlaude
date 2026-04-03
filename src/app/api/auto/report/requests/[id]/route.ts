import { NextRequest, NextResponse } from 'next/server';
import { respondToCEORequest, getCEORequest, createAutoFinding, initAutoTables } from '@/lib/autonomous/db';
import type { CEORequestStatus } from '@/lib/autonomous/types';

const VALID_STATUSES = new Set(['approved', 'rejected', 'answered']);

// PATCH /api/auto/report/requests/[id]
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    initAutoTables();
    const { id } = await params;
    const body = await request.json();
    const { status, response } = body;

    if (!status || !VALID_STATUSES.has(status)) {
      return NextResponse.json(
        { error: 'status must be one of: approved, rejected, answered' },
        { status: 400 }
      );
    }

    if (!response || typeof response !== 'string') {
      return NextResponse.json(
        { error: 'response is required' },
        { status: 400 }
      );
    }

    // Check if this request has a deferred finding blueprint before updating
    const existing = getCEORequest(id);

    const updated = respondToCEORequest(id, {
      status: status as CEORequestStatus,
      ceo_response: response,
    });

    if (!updated) {
      return NextResponse.json({ error: 'Request not found' }, { status: 404 });
    }

    // On approval, auto-create finding from deferred blueprint
    let createdFinding = null;
    if (status === 'approved' && existing?.metadata) {
      try {
        const blueprint = JSON.parse(existing.metadata);
        if (blueprint.title) {
          createdFinding = createAutoFinding({
            session_id: existing.session_id,
            category: blueprint.category || 'improvement',
            priority: blueprint.priority || 'P2',
            title: blueprint.title,
            description: blueprint.description || '',
            file_path: blueprint.file_path || null,
            epic_id: blueprint.epic_id || null,
            epic_order: blueprint.epic_order ?? null,
          });
        }
      } catch { /* ignore malformed metadata */ }
    }

    return NextResponse.json({ ...updated, created_finding: createdFinding });
  } catch {
    return NextResponse.json(
      { error: 'Failed to respond to CEO request' },
      { status: 500 }
    );
  }
}
