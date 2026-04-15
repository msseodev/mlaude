import { autoEngine } from '@/lib/autonomous/cycle-engine';
import { createSSEStreamRoute } from '@/lib/sse-stream-factory';

export const dynamic = 'force-dynamic';

const handler = createSSEStreamRoute(autoEngine, { snapshotEventType: 'session_status' });

export function GET(): Response {
  return handler();
}
