import { runManager } from '@/lib/run-manager';
import { createSSEStreamRoute } from '@/lib/sse-stream-factory';

export const dynamic = 'force-dynamic';

const handler = createSSEStreamRoute(runManager, { snapshotEventType: 'session_status' });

export function GET(): Response {
  return handler();
}
